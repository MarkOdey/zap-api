const fs = require('fs');

var q = require('q');

var mime = require("mime");
var EventEmitter = require('events').EventEmitter;


var MongoConnexion = require('../utils/MongoConnexion');

var getMetaData = function() {

    var defer = q.defer();

    var self = this;

    //console.log(url);
     
    const ls = spawn('exiftool', [ '-json', url]);
    ls.stdout.on('data', (data) => {
      
        console.log(String(data));

        var metadata = JSON.parse(String(data));

        self.emit('resolve', metadata[0]);

        defer.resolve(metadata[0]);


    });


}

getMetaData.prototype.__proto__ = EventEmitter.prototype;



var db;
function Find(key) {

    EventEmitter.apply(this, arguments);

    var self = this;

    this.data = {};

    console.log('finding data with key : '+key);

    client = MongoConnexion.get();


    client.then(function (mongoclient) {

        console.log('this should work');


        var db = mongoclient.db("zap");

        console.log('instantiating sessions');
        
        var dataCollection = db.collection('data');



        console.log('Finding asset');


       
        dataCollection.findOne({ 'key' : key }).then(function (data) {


            console.log('found asset');
   
            self.emit('resolve', data);


        }); 

        /*
        dataCollection.findOne({ weight : { $gt : Math.random(), $lt : Math.random()}}).then(function (data) {
   
            self.emit('resolve', data);


        }); 
        */

    });



}


Find.prototype.__proto__ = EventEmitter.prototype;

module.exports = Find;