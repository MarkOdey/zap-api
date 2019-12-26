const spawn = require('child_process').spawn;
var EventEmitter = require('events').EventEmitter;

var q = require('q');

var moment = require('moment');


var MongoConnexion = require('../utils/MongoConnexion');


function Concat(file) {

	var self = this;

	var ABSOLUTE_PATH = "../";

	MongoConnexion.get().then(function (mongoclient) {


		var db = mongoclient.db("zap");

		var dataCollection = db.collection('data');

		//var data = dataCollection.findOne({ MIMEType : {$regex : ".video.*"}, weight : { $gt : Math.random(), $lt : Math.random()}}).then(function (doc) {

		//var data = dataCollection.findOne({ weight : { $gt : Math.random(), $lt : Math.random()}})

		var random = Math.random();

		var data = dataCollection.find({ weight : { $gt : random, $lt : random+0.3 }}, { limit:2 }).toArray(function (err, docs) {

	
			if(docs == null) {

				console.log('no data');
				console.log(docs);
				defer.resolve();
				self.emit('resolve');
				return defer.promise;

			}


			var file1 = docs[0];
			var file2 = docs[1];


			if(file1 == undefined || file2 == undefined) {

				self.emit('resolve');
				defer.resolve();
				return;
			}


			console.log(file1);
			console.log(file2);

			var filename = file1.FileName+file2.FileName;

			filename = filename.replace(/\./g, "");


		   this.ls = spawn('./action/mmcat', [ 
		    						file1.SourceFile,
		    						file2.SourceFile,
		             				'../data/concat'+filename+'.mp4']);


			this.ls.stdout.on('data', (data) => {

				console.log(`stdout: ${data}`);
				//self.emit('resolve');
				//defer.resolve();

			});

			this.ls.stderr.on('data', (data) => {

				console.log(`error: ${data}`);
				//self.emit('resolve');
				//defer.resolve();

			});

			this.ls.on('close', (code) => {

				console.log(`child process exited with code ${code}`);
				self.emit('resolve');
				defer.resolve();

			});

		});

	})


}

Concat.prototype.__proto__ = EventEmitter.prototype;

module.exports = Concat;



