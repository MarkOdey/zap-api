var Play = require('./action/play.js');
var Find = require('./action/find.js');
var Crop = require('./action/crop.js');
var Concat = require('./action/concat.js');
var RemoveAll = require('./action/removeAll.js');
var Explore = require('./action/explore.js');

var Session = require('./session.js');

var Cognition = require('./cognition.js');


var Upload = require('./action/upload.js');

//Index available actions
var actions = {

	"play" : Play,
	"find" : Find,
	"crop" : Crop,
	"concat" : Concat,
	"removeAll" : RemoveAll,
	"explore" : Explore

}




//Add actions a Session can handle.
Session.addAction(Play);




//This is in case you want to run a specific command
//We check if action specified.
if(process.argv[2] != undefined) {

	console.log(process.argv[2]);

	//First param is action
	var Action = actions[process.argv[2]];

	console.log('Loading action');

	//if action reference is declared and exists 
	if(Action != undefined) {

		//Pass in params.
	    var params = process.argv[3];


		var action = new Action(params);

		action.run();

	}


} else {


}




var cognition = new Cognition();

cognition.run();
