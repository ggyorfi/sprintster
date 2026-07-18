import { useState } from 'react';
import { Select } from './Select.js';

export default { title: 'UI/Select' };

const roles = [
  { value: 'admin', label: 'admin' },
  { value: 'member', label: 'member' },
  { value: 'guest', label: 'guest' },
];

export const Default = () => {
  const [v, setV] = useState('member');
  return <Select label="Role" value={v} onChange={setV} options={roles} />;
};

export const WithPlaceholder = () => {
  const [v, setV] = useState('');
  return <Select label="Role" value={v} onChange={setV} options={roles} placeholder="none" />;
};
