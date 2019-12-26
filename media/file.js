const spawn = require('child_process').spawn;
var EventEmitter = require('events').EventEmitter;


var Record = require('../action/record.js');

var q = require('q');

const fs = require('fs');


var MongoConnexion = require('../utils/MongoConnexion');



var getMetaData = function(url) {

    var self = this;

    var defer = q.defer();

    console.log(url);

    const ls = spawn('exif', [ '-m','-c', url]);

    ls.stdout.on('data', (data) => {


      
        console.log("A get metadata",String(data));

        data = String(data);

        var metaItems = data.split('\n');

        var metaData = {};

        for(var i in metaItems) {

        	console.log(metaItems[i]);

        	var metaKeyValue = metaItems[i].split('\t');

        	metaData[metaKeyValue[0]] =  metaKeyValue[1];


        }



        defer.resolve(metaData);


    });


    return defer.promise;

}


function File(file) {

	var self = this;

	var ABSOLUTE_PATH = "../";


	if(file != undefined) {

		Object.apply(self, file);
	
	}

	//Setting the key for this item.
	if(self.source != undefined && self.key == undefined) {

		//The unique identifier is the source file.
		self.key = self.source;
	}


	console.log('/**Instantiation of file.**/');
	console.log(self.source);

	getMetaData(self.source).then(function(meta) {

		console.log('File is retriving the metadata');
		console.log(meta)

		Object.apply(self, meta);

		var record = new Record(self);

		record.on('resolve', function (self) {

			console.log('data record updated.')

			//console.log(data);

		});



	});





}


File.equals = function (data) {

	//We check if the file exists;
	var fs = require('fs');
	if (fs.existsSync(path)) {
	    
	    return true;
	}

}


File.prototype.__proto__ = EventEmitter.prototype;

module.exports = File;



