var MongoClient = require('mongodb').MongoClient;
var q = require('q');


var MongoConnexion = function() {

	var self = this;

	this.client;

	this.instantiated = false;

	var initDefer = q.defer();


	this.get = function () {

		if(self.client != undefined) {

			console.log('Mongo Client already instantiated.')

			var defer = q.defer();
			defer.resolve(self.client);

			return defer.promise;

		} else {

			console.log('Mongo Client not yet instantiated.')

			return initDefer.promise;
		
		}

	
	}

	this.init = function () {

		
		MongoConnexion.instantiated = true;

		MongoClient.connect('mongodb://localhost:27017/zap', {useUnifiedTopology: true}).then(function(err, mongocli) {


			if(err) {

				console.log('Mongo Error');
				console.log(err);
			}
			
			self.client = mongocli;

			console.log('Mongo Client connected.');

			initDefer.resolve(self.client);

		});

	

	}


	if(MongoConnexion.instantiated == false) {

		self.init();
	}




}


MongoConnexion.instantiated = false;


var mongoConnexion = new MongoConnexion();

module.exports = mongoConnexion;



