const { Message, ActorAddress, MessageType, MessageTopic } = require('./message');

const NodeStatus = {
  LEADER: 'leader',
  FOLLOWER: 'follower',
  CANDIDATE: 'candidate',
  UNKNOWN: 'unknown'
};

class ClusterNode {
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.address = options.address || 'localhost';
    this.port = options.port || 8081;
    this.status = options.status || NodeStatus.UNKNOWN;
    this.actors = options.actors || [];
    this.lastHeartbeat = options.lastHeartbeat || Date.now();
    this.metadata = options.metadata || {
      version: '1.0.0',
      platform: 'node',
      resources: {}
    };
    this.connection = options.connection || null;
  }

  generateId() {
    return `node_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  getUrl() {
    return `http://${this.address}:${this.port}`;
  }

  getWebSocketUrl() {
    return `ws://${this.address}:${this.port}`;
  }

  isHealthy(timeout = 30000) {
    return Date.now() - this.lastHeartbeat < timeout;
  }

  updateHeartbeat() {
    this.lastHeartbeat = Date.now();
  }

  addActor(actorAddress) {
    const key = actorAddress.toString();
    if (!this.actors.includes(key)) {
      this.actors.push(key);
    }
  }

  removeActor(actorAddress) {
    const key = actorAddress.toString();
    const index = this.actors.indexOf(key);
    if (index !== -1) {
      this.actors.splice(index, 1);
    }
  }

  toJSON() {
    return {
      id: this.id,
      address: this.address,
      port: this.port,
      status: this.status,
      actors: this.actors,
      lastHeartbeat: this.lastHeartbeat,
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    return new ClusterNode(json);
  }
}

class ClusterManager {
  constructor(options = {}) {
    this.localNodeId = options.localNodeId || null;
    this.nodes = new Map();
    this.actorToNode = new Map();
    this.leaderId = null;
    this.heartbeatInterval = options.heartbeatInterval || 10000;
    this.electionTimeout = options.electionTimeout || 30000;
    this._heartbeatTimer = null;
  }

  init(localNode) {
    this.localNodeId = localNode.id;
    this.nodes.set(localNode.id, localNode);
    this.startHeartbeat();
  }

  registerNode(node) {
    if (!(node instanceof ClusterNode)) {
      node = ClusterNode.fromJSON(node);
    }
    this.nodes.set(node.id, node);
    console.log(`[ClusterManager] Node registered: ${node.id}`);
    return node;
  }

  unregisterNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) {
      for (const actorKey of node.actors) {
        this.actorToNode.delete(actorKey);
      }
      this.nodes.delete(nodeId);
      console.log(`[ClusterManager] Node unregistered: ${nodeId}`);
      return true;
    }
    return false;
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getLocalNode() {
    return this.nodes.get(this.localNodeId);
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  getHealthyNodes() {
    return this.getAllNodes().filter(n => n.isHealthy());
  }

  findActorNode(actorAddress) {
    const key = actorAddress.toString();
    const nodeId = this.actorToNode.get(key);
    if (nodeId) {
      return this.nodes.get(nodeId);
    }
    return null;
  }

  registerActor(nodeId, actorAddress) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.addActor(actorAddress);
      this.actorToNode.set(actorAddress.toString(), nodeId);
    }
  }

  unregisterActor(actorAddress) {
    const key = actorAddress.toString();
    const nodeId = this.actorToNode.get(key);
    if (nodeId) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.removeActor(actorAddress);
      }
      this.actorToNode.delete(key);
    }
  }

  startHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
    }
    this._heartbeatTimer = setInterval(() => {
      this.checkNodes();
    }, this.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  checkNodes() {
    const now = Date.now();
    for (const [nodeId, node] of this.nodes) {
      if (nodeId !== this.localNodeId && !node.isHealthy()) {
        console.warn(`[ClusterManager] Node unhealthy: ${nodeId}`);
        this.unregisterNode(nodeId);
      }
    }
  }

  setLeader(nodeId) {
    this.leaderId = nodeId;
    const node = this.nodes.get(nodeId);
    if (node) {
      node.status = NodeStatus.LEADER;
    }
    console.log(`[ClusterManager] Leader set: ${nodeId}`);
  }

  getLeader() {
    if (this.leaderId) {
      return this.nodes.get(this.leaderId);
    }
    return null;
  }

  isLeader() {
    return this.leaderId === this.localNodeId;
  }

  getStats() {
    return {
      totalNodes: this.nodes.size,
      healthyNodes: this.getHealthyNodes().length,
      totalActors: this.actorToNode.size,
      leaderId: this.leaderId,
      localNodeId: this.localNodeId
    };
  }
}

class ClusterRouter {
  constructor(options = {}) {
    this.clusterManager = options.clusterManager || null;
    this.messageBus = options.messageBus || null;
    this.transport = options.transport || null;
  }

  async route(message) {
    if (!message.target) {
      return this.broadcast(message);
    }

    const targetNode = this.clusterManager.findActorNode(message.target);
    if (!targetNode) {
      console.warn(`[ClusterRouter] Target actor node not found: ${message.target}`);
      return null;
    }

    if (targetNode.id === this.clusterManager.localNodeId) {
      return this.messageBus.send(message.target, message);
    }

    return this.sendToNode(targetNode, message);
  }

  async sendToNode(node, message) {
    if (this.transport) {
      return this.transport.send(node, message);
    }
    console.warn('[ClusterRouter] No transport configured');
    return null;
  }

  async broadcast(message) {
    const results = [];

    const localResult = await this.messageBus.broadcast(message);
    if (localResult) {
      results.push(...localResult);
    }

    if (this.transport) {
      const remoteNodes = this.clusterManager.getHealthyNodes()
        .filter(n => n.id !== this.clusterManager.localNodeId);

      for (const node of remoteNodes) {
        try {
          const result = await this.transport.send(node, message);
          if (result) {
            results.push(result);
          }
        } catch (err) {
          console.error(`[ClusterRouter] Failed to send to node ${node.id}:`, err.message);
        }
      }
    }

    return results;
  }
}

class EdgeOrchestrator {
  constructor(options = {}) {
    this.clusterManager = options.clusterManager || null;
    this.resourceRequirements = new Map();
  }

  deployActor(deployment) {
    const candidates = this.findCandidateNodes(deployment);
    if (candidates.length === 0) {
      console.warn(`[EdgeOrchestrator] No suitable node for actor: ${deployment.actorId}`);
      return null;
    }

    const selected = this.selectBestNode(candidates, deployment);
    return this.deployToNode(selected, deployment);
  }

  findCandidateNodes(deployment) {
    const nodes = this.clusterManager.getHealthyNodes();
    return nodes.filter(node => this.meetsRequirements(node, deployment.resourceRequirements));
  }

  selectBestNode(candidates, deployment) {
    if (candidates.length === 1) {
      return candidates[0];
    }

    const preferred = candidates.find(n => 
      this.getNodeRole(n) === deployment.preferredLocation
    );
    if (preferred) {
      return preferred;
    }

    return candidates.reduce((best, current) => {
      const bestLoad = this.getNodeLoad(best);
      const currentLoad = this.getNodeLoad(current);
      return currentLoad < bestLoad ? current : best;
    });
  }

  getNodeRole(node) {
    if (node.metadata && node.metadata.role) {
      return node.metadata.role;
    }
    return 'server';
  }

  getNodeLoad(node) {
    return node.actors.length;
  }

  meetsRequirements(node, requirements) {
    if (!requirements) return true;

    const resources = node.metadata.resources || {};

    if (requirements.microphone !== undefined && 
        resources.hasMicrophone !== requirements.microphone) {
      return false;
    }

    if (requirements.speaker !== undefined && 
        resources.hasSpeaker !== requirements.speaker) {
      return false;
    }

    if (requirements.camera !== undefined && 
        resources.hasCamera !== requirements.camera) {
      return false;
    }

    if (requirements.minMemory && resources.memory < requirements.minMemory) {
      return false;
    }

    return true;
  }

  deployToNode(node, deployment) {
    this.clusterManager.registerActor(node.id, deployment.actorAddress);
    console.log(`[EdgeOrchestrator] Actor ${deployment.actorId} deployed to node ${node.id}`);
    return node;
  }

  undeployActor(actorAddress) {
    this.clusterManager.unregisterActor(actorAddress);
  }

  rebalance() {
    const nodes = this.clusterManager.getHealthyNodes();
    if (nodes.length < 2) return;

    const avgLoad = nodes.reduce((sum, n) => sum + n.actors.length, 0) / nodes.length;

    const overloaded = nodes.filter(n => n.actors.length > avgLoad * 1.5);
    const underloaded = nodes.filter(n => n.actors.length < avgLoad * 0.5);

    const migrations = [];
    for (const source of overloaded) {
      const toMigrate = source.actors.slice(Math.floor(avgLoad));
      for (const actorKey of toMigrate) {
        const target = underloaded.reduce((best, current) => 
          current.actors.length < best.actors.length ? current : best
        , underloaded[0]);

        if (target && target.actors.length < avgLoad) {
          migrations.push({
            actor: actorKey,
            from: source.id,
            to: target.id
          });
        }
      }
    }

    return migrations;
  }
}

module.exports = {
  ClusterNode,
  ClusterManager,
  ClusterRouter,
  EdgeOrchestrator,
  NodeStatus
};
