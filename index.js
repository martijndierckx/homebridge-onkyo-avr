var Service;
var Characteristic;
var Volume;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var util = require('util');

function makeVolumeCharacteristic() {
  Volume = function() {
    Characteristic.call(this, 'Volume', '90288267-5678-49B2-8D22-F57BE995AA93');
    this.setProps({
      format: Characteristic.Formats.UINT8,
      maxValue: 40,
      minValue: 0,
      minStep: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };

  util.inherits(Volume, Characteristic);
}

module.exports = function(homebridge)
{
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  
  makeVolumeCharacteristic();
  
  homebridge.registerAccessory("homebridge-onkyo-avr", "OnkyoAVR", HttpStatusAccessory);
}

/*
exports.init = function(log, config)
{
	return new HttpStatusAccessory(log, config);
}*/

function HttpStatusAccessory(log, config) 
{
	this.log = log;
	var that = this;
	this.eiscp = require('eiscp');
	this.setAttempt = 0;

	// config
	this.ip_address	= config["ip_address"];
	this.name = config["name"];
	this.model = config["model"];
	this.poll_status_interval = config["poll_status_interval"] || "0";
	this.zone = config["zone"] || "main";
	this.set_power = config["set_power"] || false;
		
	this.state = false;
	this.volumeLevel = 0;
	this.maxVolume = config["maxVolume"] || 70;
	
	this.interval = parseInt( this.poll_status_interval);
	this.avrManufacturer = "Onkyo";
	this.avrSerial = this.zone;
	
	this.switchHandling = "check";
	if (this.interval > 10 && this.interval < 100000) {
		this.switchHandling = "poll";
	}
	
	this.eiscp.on('debug', this.eventDebug.bind(this));
	this.eiscp.on('error', this.eventError.bind(this));
	this.eiscp.on('connect', this.eventConnect.bind(this));
	this.eiscp.on('connect', this.eventConnect.bind(this));
	this.eiscp.on('volume', this.eventVolume.bind(this));
	this.eiscp.on('close', this.eventClose.bind(this));

	if(this.zone == 'main') {
		this.eiscp.on('system-power', this.eventSystemPower.bind(this));
	}
	else {
		this.eiscp.on('power', this.eventPower.bind(this));
	}
	
	this.eiscp.connect(
		{host: this.ip_address, reconnect: true, model: this.model}
	);

	
	//that.log("hello - "+config["ip_address"]);
	// Status Polling
	if (this.switchHandling == "poll") {
		var powerurl = this.status_url;
		that.log("start long poller..");
		
		var statusemitter = pollingtoevent(function(done) {
			that.log("start polling..");
			that.getPowerState( function( error, response) {
				//pass also the setAttempt, to force a homekit update if needed
				done(error, response, that.setAttempt);
				that.getVolume( function( error, response) {
				});
			}, "statuspoll");
		}, {longpolling:true,interval:that.interval * 1000,longpollEventName:"statuspoll"});

		statusemitter.on("statuspoll", function(data) {
			that.state = data;
			that.log("event - status poller - new state: ", that.state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.On).setValue(that.state, null, "statuspoll");
			}
		});
	}
}

HttpStatusAccessory.prototype = {

eventDebug: function( response)
{
	//this.log( "eventDebug: %s", response);
},

eventError: function( response)
{
	this.log( "eventError: %s", response);
},

eventConnect: function( response)
{
	this.log( "eventConnect: %s", response);
},

eventPower: function( response)
{
	//this.log( "eventSystemPower: %s", response);
	this.state = (response == "on");
	this.log("eventPower - message: %s, new state %s", response, this.state);
	//Communicate status
	if (this.switchService ) {
		this.switchService.getCharacteristic(Characteristic.On).setValue(this.state, null, "statuspoll");
	}
},

eventSystemPower: function( response)
{
	//this.log( "eventSystemPower: %s", response);
	this.state = (response == "on");
	this.log("eventSystemPower - message: %s, new state %s", response, this.state);
	//Communicate status
	if (this.switchService ) {
		this.switchService.getCharacteristic(Characteristic.On).setValue(this.state, null, "statuspoll");
	}	
},

eventVolume: function( response)
{
	this.log( "eventVolume: %s", response);
	this.volumeLevel = response || 0;
	
	//Communicate status
	if (this.volumeService ) {
		this.volumeService.getCharacteristic(this.characteristic).setValue(this.volumeLevel, null, "statuspoll");
	}	
},

setVolume: function( newValue, callback, context) {
	var that = this;
	if (context && context == "statuspoll") {
		this.log( "setVolume - polling mode, ignore, volume: %s", this.volumeLevel);
		callback(null, this.volumeLevel);
	    return;
	}
	
	that.log( "setVolume - actual mode, volume: %s", newValue);
	
	callback(null);

	if(newValue > this.maxVolume) {
		newValue = this.maxVolume;
	}
	
    this.eiscp.command(this.zone+'.volume=' + newValue);      
},

getVolume: function( callback, context) {
	var that = this;
	if (context && context == "statuspoll") {
		this.log( "getVolume - polling mode, ignore, volume: %s", this.volumeLevel);
		callback(null, this.volumeLevel);
	    return;
	}
	
	that.log('getVolume - actual mode, oldValue: ' + this.volumeLevel);
	callback(null, this.volumeLevel);
	
	this.eiscp.command(this.zone + '.volume=query');
},

eventClose: function( response)
{
	this.log( "eventClose: %s", response);
},

setPowerState: function(powerOn, callback, context) {
	if(!this.set_power) {
		callback( null, this.state);
		return;
	}

	var that = this;
//if context is statuspoll, then we need to ensure that we do not set the actual value
	if (context && context == "statuspoll") {
		this.log( "setPowerState - polling mode, ignore, state: %s", this.state);
		callback(null, this.state);
	    return;
	}
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }

	this.setAttempt = this.setAttempt+1;

	var target = 'system-power';
    if(this.zone != 'main') {
    	target = this.zone + ".power";
    }
		
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	that.state = powerOn;
	callback( null, that.state);
    if (powerOn) {
		this.log("setPowerState - actual mode, power state: %s, switching to ON", that.state);
		this.eiscp.command(target+"=on", function(error, response) {
			//that.log( "PWR ON: %s - %s -- current state: %s", error, response, that.state);
			if (error) {
				that.state = false;
				that.log( "setPowerState - PWR ON: ERROR - current state: %s", that.state);
				if (that.switchService ) {
					that.switchService.getCharacteristic(Characteristic.On).setValue(powerOn, null, "statuspoll");
				}					
			}
		}.bind(this) );
	} else {
		this.log("setPowerState - actual mode, power state: %s, switching to OFF", that.state);
		this.eiscp.command(target+"=standby", function(error, response) {
			//that.log( "PWR OFF: %s - %s -- current state: %s", error, response, that.state);
			if (error) {
				that.state = false;
				that.log( "setPowerState - PWR OFF: ERROR - current state: %s", that.state);
				if (that.switchService ) {
					that.switchService.getCharacteristic(Characteristic.On).setValue(powerOn, null, "statuspoll");
				}					
			}			
		}.bind(this) );		
    }
},
  
getPowerState: function(callback, context) {
	var that = this;
	//if context is statuspoll, then we need to request the actual value
	if (!context || context != "statuspoll") {
		if (this.switchHandling == "poll") {
			this.log("getPowerState - %s - polling mode, return state: ", this.zone, this.state);
			callback(null, this.state);
			return;
		}
	}
	
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback(null, this.state);
    this.log("getPowerState - %s - actual mode, return state: ", this.zone, this.state);

    var target = 'system-power';
    if(this.zone != 'main') {
    	target = this.zone + ".power";
    }

	this.eiscp.command(target+"=query", function( error, data) {
		if (error) {
			that.state = false;
			that.log( "getPowerState - %s - PWR QRY: ERROR - current state: %s", that.zone, that.state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.On).setValue(that.state, null, "statuspoll");
			}					
		}	
	}.bind(this) );
},

identify: function(callback) {
    this.log("Identify requested!");
    callback(); // success
},

getServices: function() {
	var that = this;

	var informationService = new Service.AccessoryInformation();
    informationService
    .setCharacteristic(Characteristic.Manufacturer, this.avrManufacturer)
    .setCharacteristic(Characteristic.Model, this.model)
    .setCharacteristic(Characteristic.SerialNumber, this.avrSerial)
	.addCharacteristic(Characteristic.Category, 7);	

	this.switchService = new Service.Lightbulb(this.name);
	this.switchService
		.getCharacteristic(Characteristic.On)
		.on('get', this.getPowerState.bind(this))
		.on('set', this.setPowerState.bind(this));

	this.switchService
        .addCharacteristic(new Characteristic.Brightness())
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));
		
	return [informationService, this.switchService];
}
};

