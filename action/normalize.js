const spawn = require('child_process').spawn;
var EventEmitter = require('events').EventEmitter;


var Find = require('./find.js');

var q = require('q');

var MongoConnexion = require('../utils/MongoConnexion');



function Normalize(data) {

	var self = this;

	if(data != undefined) {

		Object.assign(this, data);
	
	}

	console.log(data);

	console.log("Generating new file : " +this.source);

	if(this.source == undefined) {

		console.log('no source defined');
		return;
	}

	var filenameKeyValue = this.source.split('.');

	var filename = filenameKeyValue[0];



	var normalizedFile = './' + filename + '.mp4';

    var cmd = spawn('ffmpeg', [ "-i", self.source, '-y',
                            "-vcodec", "libx264",
                            "-crf", "23", 
                            "-preset", "ultrafast",
                            "-acodec", "aac",
                            "-strict", "experimental", 
                            "-ac", "2", 
                            "-ar", "44100", 
                            "-ab", "128k",
                            "-async", "1", normalizedFile]);


	cmd.stdout.on('data', (data) => {

		console.log(`stdout: ${data}`);

	});

	cmd.stderr.on('data', (data) => {

		console.log(`stderr: ${data}`);

	});

	cmd.on('close', (code) => {

		self.source = normalizedFile;
		self.emit('resolve', self);

	});


}

Normalize.prototype.__proto__ = EventEmitter.prototype;

module.exports = Normalize;



