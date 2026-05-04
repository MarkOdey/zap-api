const anything = require('./relation/anything.js');

function Cognition() {
  this.run = async function () {
    try {
      const data = await anything();
      console.log('cognition:', data);
    } catch (err) {
      console.warn('cognition error:', err.message);
    }
  };
}

module.exports = Cognition;
