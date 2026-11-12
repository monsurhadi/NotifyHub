'use strict';
const { badRequest } = require('../domain/errors');

/**
 * Factory + registry. New channels are added with `register()` and never require
 * touching the dispatch code (Open/Closed Principle, NFR-07).
 */
class ChannelFactory {
  constructor() { this.builders = new Map(); this.instances = new Map(); }
  register(name, build) { this.builders.set(name, build); return this; }
  supports(name) { return this.builders.has(name); }
  names() { return [...this.builders.keys()]; }
  create(name) {
    if (!this.builders.has(name)) throw badRequest(`Unsupported channel "${name}". Supported: ${this.names().join(', ')}`, { field: 'channel' }, 'unsupported_channel');
    if (!this.instances.has(name)) this.instances.set(name, this.builders.get(name)());
    return this.instances.get(name);
  }
}
module.exports = { ChannelFactory };
