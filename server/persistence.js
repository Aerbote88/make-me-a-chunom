import {getPWD} from '/lib/base';
import {Progress} from '/lib/glyphs';
import { spawn } from 'child_process';
import path from 'path';

const getBackupPath = () => {
  return path.join(getPWD(), 'server', 'backup');
}

Meteor.methods({
  async backup() {
    const backupPath = getBackupPath();
    try {
      const child = spawn('mongodump', ['--port', '3001', '--out', backupPath]);
      child.on('error', (err) => {
        console.error('Backup failed - mongodump not available:', err.message);
      });
      await Progress.updateAsync({}, {$set: {backup: true}});
    } catch (err) {
      console.error('Backup failed:', err.message);
    }
  },
  async restore() {
    const backupPath = getBackupPath();
    try {
      const child = spawn('mongorestore', ['--port', '3001', '--drop', backupPath]);
      child.on('error', (err) => {
        console.error('Restore failed - mongorestore not available:', err.message);
      });
    } catch (err) {
      console.error('Restore failed:', err.message);
    }
  },
});
