const fs = require('fs');

var q = require('q');

var mime = require("mime");


var MongoConnexion = require('../utils/MongoConnexion');

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;

const spawn = require('child_process').spawn;


var db;

/**
 * Action for removing all files.
 */
function RemoveAll() {

    EventEmitter.apply(this, arguments);

    var self = this;

    this.data = {};

    console.log('Removing all assets');

    MongoConnexion.get().then(function (client) {

        console.log('mongo client retrived at Record.');
        
        var db = client.db("zap");

        var data = db.collection('data');

        data.remove({});
        
        console.log('Assets removed');

        this.emit('resolve');


    }); 

    

}

RemoveAll.prototype.__proto__ = EventEmitter.prototype;

module.exports = RemoveAll;