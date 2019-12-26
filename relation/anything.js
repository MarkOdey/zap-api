
var EventEmitter = require('events').EventEmitter;

var Find = require('../action/find.js');

function Anything () {

	EventEmitter.apply(this, arguments);

	var self = this;

	console.log('Loading anything');

	var find = new Find();
	find.on('resolve', function(data){

		console.log('Result for anything.')
		console.log(data);


		self.emit("resolve", data);


	});


}



Anything.prototype.__proto__ = EventEmitter.prototype;


module.exports = Anything;