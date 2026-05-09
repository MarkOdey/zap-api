function Relation(data) {
  const self = this;

  if (data != undefined) {
    Object.assign(this, data);
  }

  if (self.source != undefined) {
    self.key = self.source;
  }
}

module.exports = Relation;