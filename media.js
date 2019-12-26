var Image = require("./media/image.js");
var Video = require("./media/video.js");

function _media () {

	this.medias = [];

	this.get = function (data) {


		for(var i in this.medias) {

			if(this.medias[i].equals == undefined) {

				continue;
			}

			if(this.medias[i].equals(data)) {

				return this.medias[i];
			}
		}

	}

	this.add = function (media) {

		this.medias.push(media);

	}

}

Media = new _media(); 


Media.add(Image);
Media.add(Video);

module.exports = Media;


