import { useState } from 'react';
import { RefPicker } from './RefPicker.js';

export default { title: 'UI/RefPicker' };

const options = [
  { value: 't1', label: 'Alfie Granger' },
  { value: 't2', label: 'Thomas Lam' },
  { value: 't3', label: 'Mira Chen' },
  { value: 't4', label: 'Ada Lovelace' },
  { value: 't5', label: 'Grace Hopper' },
];

export const Single = () => {
  const [v, setV] = useState('');
  return <RefPicker label="Client" value={v} onChange={setV} options={options} placeholder="Search clients..." />;
};

export const Multiple = () => {
  const [v, setV] = useState('["t1","t3"]');
  return <RefPicker label="Tags" value={v} onChange={setV} options={options} multiple placeholder="Search tags..." />;
};
