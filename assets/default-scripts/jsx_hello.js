'use strict';

import { render } from "emw-jsx";
import { Column, Text, Button } from "emw-ui";

var count = 0;

function increment() {
  count += 1;
  rerender();
}

function reset() {
  count = 0;
  rerender();
}

function App() {
  return (
    <Column padding={16} spacing={12}>
      <Text font="title2" fontWeight="semibold">JSX Hello</Text>
      <Text>Count: {count}</Text>
      <Button onTap={increment}>Increment</Button>
      <Button onTap={reset}>Reset</Button>
    </Column>
  );
}

function rerender() {
  render(<App />);
}

rerender();
