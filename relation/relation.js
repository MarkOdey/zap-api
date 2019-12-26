
var Find = require('./action/find.js');

function Relation (data) {

	var self = this;

	if(data != undefined) {

		Object.assign(this, data);
	
	}


    if(self.source != undefined) {

        self.key = self.source;
        
    }

}




module.exports = Anything;