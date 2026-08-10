import React from 'react';

export function Greeting({ name }) {
  return (
    <div className="greeting">
      <h1>Hello, {name}!</h1>
      <p>Welcome to the app.</p>
    </div>
  );
}

export default Greeting;
