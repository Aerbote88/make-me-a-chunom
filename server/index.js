import {Glyphs} from '/lib/glyphs';

Meteor.publish('index', function(radical) {
  return Glyphs.find({radical: radical});
});
