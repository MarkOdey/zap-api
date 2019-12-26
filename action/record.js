
var MongoConnexion = require('../utils/MongoConnexion');

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;


function Record(data) {

    var self = this;

    console.log('Record data.');
    //console.log(data);

    MongoConnexion.get().then(function (client) {

        console.log('mongo client retrived at Record.');
        
        var db = client.db("zap");
        var col = db.collection('data');

        if(data.key == undefined) {

            throw "No key specified."
        }

        data.weight = Math.random();

        col.update({"key" : data.key },        
            data
            , 
           { 
                upsert : true 
            }, function (err, data) {

                if(err) {

                    console.log('Did not update properly.');
                    
                    self.emit('reject');
                    return;

                }


                //console.log(data);

                console.log('Record updated.');

                self.emit('resolve', data);



            });


	});



}


Record.prototype.__proto__ = EventEmitter.prototype;

module.exports = Record;