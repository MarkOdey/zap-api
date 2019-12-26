var EventEmitter = require('events').EventEmitter;

var Explore = require('./action/explore.js');
var Find = require('./action/find.js');
var RemoveAll = require('./action/removeAll.js');

var http = require('http');

const express = require('express');
const app = express();
app.use(express.static('../'));

var io = require('socket.io')(8080);

console.log('instantiation of socket io');

io.on('connection', function(socket) {
    console.log('a user connected');

    socket.emit('connected');

    //socket.join(socket.id);
    //
    //return;

    var session = new Session(socket);

    Session.status.emit('connection', session);

    session.update();


});

function Session(socket) {

    var self = this;

    this.socket = socket;

    var deleted = false;

    this.update = function () {

        var action;

        for(var i in self.actions) {

            console.log('//////////Checking for actions in stack.')

            if(Math.floor(Math.random()*2) == 0) {

                action = new self.actions[i](this);

            }

        }

        if(deleted == true) {

            return;

        }

        if(action == undefined) {

            console.log('----------------------ACTION IS UNDEFINED-----------------')
            this.update();

            return;

        } else {

            //If action is successful 
            action.on('resolve', function () {

                console.log("resolving action for socket "+socket.id);
                console.log('action');
                setTimeout(function () {
    
                    self.update();

                }, 2000);

            });

            //If action is unsucessful
            action.on('reject', function () {

                setTimeout(function () {
    
                    self.update();

                }, 2000);


            });

        }

    }
    
    Session.sessions.push(this);

    this.socket.on('disconnect', (reason) => {

        console.log('at user disconnect');
        self.destroy();


    });

    //Interface for adding an action in the stack of actions.
    this.socket.on('run', function(data) {

        console.log(data);

        try{

            eval("var action=" + data);

            console.log('Run action from terminal : ', data);

            //Nothing was returned from the socket command 
            if(action == undefined) {

                return;
            }

            //Checking if the action has an emitter pattern declared.
            if(typeof action.on == 'function') {

                action.on('resolve', function(){

                    console.log('test');
                });

            } else {

                console.log('no on function defined');
            }

        } catch (err) {

            console.log(err);
            console.log('error running the code ')

        }

    });

    this.destroy = function  () {

        var index = Session.sessions.indexOf(self);

        Session.sessions.splice(index);

        deleted = true;
    }

}

Session.prototype.__proto__ = EventEmitter.prototype;

Session.status = new EventEmitter();

/**
 * List of actions that a session can run. 
 * @type {Array}
 */
Session.actions = Session.prototype.actions = [];

/**
 * Adds an action to the action list.
 * @param {Object} action an action that a session can run to interface.
 */
Session.addAction = function (action) {

    Session.actions.push(action);

}

Session.sessions = [];


module.exports = Session;