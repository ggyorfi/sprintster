import { useState } from 'react';
import { TextField } from './TextField.js';

export default { title: 'UI/TextField' };

export const Default = () => {
  const [v, setV] = useState('Ada Lovelace');
  return <TextField label="Name" value={v} onChange={setV} placeholder="e.g. Ada Lovelace" />;
};

export const Multiline = () => {
  const [v, setV] = useState('Line one\nLine two');
  return <TextField label="Notes" value={v} onChange={setV} multiline rows={4} />;
};

export const WithPrefix = () => {
  const [v, setV] = useState('50.00');
  return <TextField label="Rate" value={v} onChange={setV} prefix="£" inputMode="decimal" />;
};

export const WithError = () => <TextField label="Email" value="not-an-email" error="Enter a valid email" onChange={() => {}} />;

export const ReadOnly = () => <TextField label="Legacy id" value="GRA-A26" readOnly onChange={() => {}} />;
