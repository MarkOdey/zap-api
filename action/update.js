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
function Update(data) {

    EventEmitter.apply(this, arguments);

    var self = this;

    console.log('At update :', data);


    if(data.key == undefined) {

        console.warn("No key setup. Before updating please ensure you have a key.");
    }
       
      
    MongoConnexion.get().then(function (mongoclient) {

        var db = mongoclient.db("zap");
        var dataCollection = db.collection('data');

        console.log('Updating any asset');



        dataCollection.updateOne({ 'key' : data.key }, data, { upsert : true}, function (data) {
   
            console.log('data updated.')
            self.emit('resolve', data);


        }); 

        /*
        dataCollection.updateOne({ weight : { $gt : Math.random(), $lt : Math.random()}}).then(function (data) {
   
            self.emit('resolve', data);


        }); 
        */

    });



}


Update.prototype.__proto__ = EventEmitter.prototype;

module.exports = Update;