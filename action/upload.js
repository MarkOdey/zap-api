const spawn = require('child_process').spawn;
var EventEmitter = require('events').EventEmitter;

var fs = require('fs');

var Media = require('../media.js');

var Session = require('../session.js');

Session.status.on('connection', function(session) {

	session.socket.on('upload', function (data) {

		console.log('uploading');
		var upload = new Upload(data);

	});

});

var q = require('q');

var moment = require('moment');

function Upload(data) {


	if(typeof data == 'string') {

		var payload = JSON.parse(data);

		console.log(payload.meta);

		Object.assign(this, payload);

	}

	var self = this;

	console.log(this.file);

	var ABSOLUTE_PATH = "../";


	this.init = function () {

		var defer = q.defer();
	
		let base64Image = self.data.split(';base64,').pop();

		var source = 'data/'+self.meta.name;

		self.source = source;

		fs.writeFile(source, base64Image, {encoding: 'base64'}, function(err) {

			if(err) {

				console.log(err);

			}

			self.meta.source = 'data/'+self.meta.name;

			var Mediaitem = Media.get(self.meta);


			var media = new Mediaitem(self.meta);
		    console.log('File created');

		    defer.resolve();

		});

		
		return defer.promise;

	}

	this.init();

}

Upload.prototype.__proto__ = EventEmitter.prototype;

module.exports = Upload;