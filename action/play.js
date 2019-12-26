

var MongoConnexion = require('../utils/MongoConnexion');
var q = require('q');

var Update = require('./update.js');


var EventEmitter = require('events').EventEmitter;


function Play(data) {

	console.log('Play Action');
 
    var self = this;

    this.data = data;

    EventEmitter.apply(this, arguments);

    var a = 0;
    var b = 0;

    var findRandom = function () {

		MongoConnexion.get().then(function (mongoclient) {

			console.log('Connexion esthablished at play');

			var db = mongoclient.db("zap");

			var dataCollection = db.collection('data');

			console.log('Attempting to find an element.');

			a = Math.random();
			b = Math.random();

			//var data = dataCollection.findOne({ MIMEType : {$regex : ".video.*"}, weight : { $gt : Math.random(), $lt : Math.random()}}).then(function (doc) {
			var query = {
				weight : { $gt : a, $lt : a+b}
			}

			
			var dataQuery = dataCollection.findOne(query, function (err, data) {

			    if(data == null) {
			      console.log('no data');
			    
			      self.emit('resolve');
			      return;
			    }

			    console.log('Found an element :', data.SourceFile);
			    console.log('Attempting to play a random file :');
				console.log(data);

				//we check if the action has a socket.
			   	if(self.data.socket == undefined) {

			   		return;
			   	}

			   	var socket = self.data.socket;

			   	socket.emit('play', data);

			   	self.key = "Play("+self.data.key+")"

			    socket.once('resolve', function () {

					console.log('Resolving in play.js with :' + socket.id);

					if(self.data.weight == undefined) {

						self.data.weight = 0.5;
					} else {
						self.data.weight += 0.1;
					}


					var update = new Update(self);

					update.on('resolve', function() {


						self.emit('resolve', self.data);


					});



					socket.removeAllListeners('resolve');
					socket.removeAllListeners('reject');

			    });

			    socket.once('reject', function() {

			  
			    	if(self.weight == undefined) {

						self.weight = 0.5;
					} else {
						self.weight -= 0.1;
					}

					var update = new Update(self);

					update.on('resolve', function() {

		
						self.emit('reject', self);


					});


		

			    	socket.removeAllListeners('resolve');
					socket.removeAllListeners('reject');

			    });



			});

		});
    }

    //If play has no key.
    if(this.data.key == undefined) {

    	console.log('data is undefined');

    	findRandom();

    }





}


Play.prototype.__proto__ = EventEmitter.prototype;

module.exports = Play;