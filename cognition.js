
var Crop = require('./action/crop.js');
var Concat = require('./action/concat.js');
var Normalize = require('./action/normalize.js');

var Anything = require('./relation/anything.js')

var Explore = require('./action/explore.js');

var EventEmitter = require('events').EventEmitter;

function Cognition () {


 	EventEmitter.apply(this, arguments);

	var self = this;


	this.actions = [];

	this.knowledge = [];


	//this.actions.push(new Explore());
	//this.actions.push(new Crop());
	//this.actions.push(new Normalize());
	//
	



	this.run = function () { 

		var promise = this.update();
	}

	this.update = function () {

		console.log("Running command");

		var anything = new Anything();


		if(anything != undefined) {

			anything.on('resolve', function (data) {


				self.emit('resolve', data);


			});
		
		}



	}

}

Cognition.prototype.__proto__ = EventEmitter.prototype;


module.exports = Cognition;
