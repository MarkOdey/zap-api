var Normalize = require('../action/normalize.js');

var File = require('./file.js');

function Video (data) {

	var self = this;

	if(data != undefined) {

		Object.assign(this, data);
	
	}


    if(self.source != undefined) {

        self.key = self.source;
        
    }


	//	console.log(data);

	console.log('at video : ', data);


	var normalize = new Normalize(data);

	normalize.on('resolve', function(normalizedData) {

		Object.assign(self, normalizedData);

		console.log('converted');

		//hinerits from the File primitive;
     	File.call(self);

	});

}


Video.prototype = File.prototype;        // Set prototype to Person's
Video.prototype.constructor = Video;   // Set constructor back to Robot




Video.equals = function (payload) {


	if(typeof payload == 'object') {

		if(payload.type.indexOf('video') != -1 && payload.name != undefined) {

      		console.log(payload);
			console.log('instantiating video object');
      		return true;

      	}

	}

	//Nothing matched.
	return false;


}


module.exports = Video;