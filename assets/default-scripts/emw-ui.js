'use strict';

function factory(name) {
  return function (props) {
    return UI[name](props || {});
  };
}

function textFactory(name, textProp) {
  return function (props) {
    var assigned = Object.assign({}, props || {});
    if (assigned[textProp] == null && Array.isArray(assigned.children) && assigned.children.length) {
      assigned[textProp] = assigned.children.map(function (child) { return String(child); }).join('');
      delete assigned.children;
    }
    return UI[name](assigned);
  };
}

var Column = factory('column');
var Row = factory('row');
var Card = factory('card');
var Text = textFactory('text', 'text');
var Button = textFactory('button', 'label');
var Tile = factory('tile');
var Slider = factory('slider');
var LogViewer = factory('logViewer');
var Scroll = factory('scroll');
var TextField = factory('textField');
var TextEditor = factory('textEditor');
var Picker = factory('picker');
var Toggle = factory('toggle');
var Grid = factory('grid');
var Plot = factory('plot');
var Modal = factory('modal');
var Spacer = factory('spacer');
var Divider = factory('divider');
var Progress = factory('progress');

module.exports = {
  UI: UI,
  render: function (node) { return UI.render(node); },
  Column: Column,
  Row: Row,
  Card: Card,
  Text: Text,
  Button: Button,
  Tile: Tile,
  Slider: Slider,
  LogViewer: LogViewer,
  Scroll: Scroll,
  TextField: TextField,
  TextEditor: TextEditor,
  Picker: Picker,
  Toggle: Toggle,
  Grid: Grid,
  Plot: Plot,
  Modal: Modal,
  Spacer: Spacer,
  Divider: Divider,
  Progress: Progress
};
