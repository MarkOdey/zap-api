var File = require('./file.js');

var q = require('q');
const spawn = require('child_process').spawn;


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




class Image {


   

    constructor  (data) {

        if(data != undefined) {

            Object.assign(self, data);
          
        }
    
        if(self.source != undefined) {
    
            self.key = self.source;
        }
    
        File.call(self);

    }    



 


}

Image.prototype = File.prototype;        // Set prototype to File
Image.prototype.constructor = Image;   // Set constructor back to Image


Image.equals = function (payload) {

	if(typeof payload == 'object') {

      	if(payload.type != undefined && payload.type.indexOf('image') != -1 && payload.name != undefined) {

      		console.log('its an image object');
      		return true;


			console.log(payload);
      		
      	}

            

      	return false;

	}

}


module.exports = Image;