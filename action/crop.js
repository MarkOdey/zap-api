const spawn = require('child_process').spawn;
var EventEmitter = require('events').EventEmitter;

var q = require('q');


var Find = require('./find.js');

var moment = require('moment');


function Crop(file, start, duration) {

	var self = this;

	var ABSOLUTE_PATH = "../";

	self.start=0;
	self.duration = 3;

	if(start != undefined) {

		self.start = start;

	}

	if(duration != undefined) {

		self.duration = duration;
	}


	this.run = function () {

		console.log('Cropping file', file);

		var defer = q.defer();


		var find = new Find();

		find.run().then(function (file) {

			console.log('at find',file);

			var db = mongoclient.db("zap");

			console.log(file.Duration, file.SourceUrl, file.FileName);

			//console.log(moment(file.Duration).seconds());
			var timeDuration = file.Duration.split(':');

			var second = Number(timeDuration[2])+Number(timeDuration[1])*60+Number(timeDuration[0])*60*60;

			console.log("Number of seconds : " + second);


			var filename = '../data/' + self.start + self.duration + file.FileName;

			console.log(self.start, self.duration);

			filename = filename.replace(/\./g, "");

		    this.ls = spawn('ffmpeg', [ "-i", file.SourceFile,
		                            "-y",
		                            "-ss", self.start,
		                            "-t", self.duration,
		                            "-acodec", "copy",
		                            "-vcodec", "copy",
		                            "-async", "1", filename]);


			this.ls.stdout.on('data', (data) => {

				console.log(`stdout: ${data}`);
				self.emit('resolve');
				defer.resolve();

			});

			this.ls.stderr.on('data', (data) => {

				console.log(`stderr: ${data}`);
				self.emit('resolve');
				defer.resolve();

			});

			ls.on('close', (code) => {

				console.log(`child process exited with code ${code}`);
				self.emit('resolve');
				defer.resolve();

			});

		});


		return defer.promise;

	}

}

Crop.prototype.__proto__ = EventEmitter.prototype;

module.exports = Crop;



