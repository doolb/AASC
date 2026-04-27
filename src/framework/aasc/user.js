const fs = require('fs');
const path = require('path');

const UserRole = {
  USER: 'user',
  MANAGER: 'manager',
  ADMIN: 'admin'
};

const SecurityLevel = {
  PUBLIC: 0,
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
  TOP_SECRET: 5
};

class User {
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.name = options.name || '';
    this.birthday = options.birthday || '';
    this.securityLevel = options.securityLevel !== undefined 
      ? options.securityLevel 
      : SecurityLevel.PUBLIC;
    this.role = options.role || UserRole.USER;
    this.createdAt = options.createdAt || Date.now();
    this.lastLoginAt = options.lastLoginAt || null;
    this.preferences = options.preferences || {};
    this.metadata = options.metadata || {};
  }

  generateId() {
    return `user_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  isManager() {
    return this.role === UserRole.MANAGER || this.role === UserRole.ADMIN;
  }

  isAdmin() {
    return this.role === UserRole.ADMIN;
  }

  canAccessLevel(level) {
    if (this.isAdmin()) return true;
    if (this.isManager()) return true;
    return this.securityLevel >= level;
  }

  updateLogin() {
    this.lastLoginAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      birthday: this.birthday,
      securityLevel: this.securityLevel,
      role: this.role,
      createdAt: this.createdAt,
      lastLoginAt: this.lastLoginAt,
      preferences: this.preferences,
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    return new User(json);
  }
}

class UserStore {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(__dirname, '../config/users.json');
    this.users = new Map();
    this.sessions = new Map();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.users.clear();
        for (const userData of data.users || []) {
          const user = User.fromJSON(userData);
          this.users.set(user.id, user);
        }
        console.log(`[UserStore] Loaded ${this.users.size} users`);
      }
    } catch (err) {
      console.error('[UserStore] Load failed:', err.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        users: Array.from(this.users.values()).map(u => u.toJSON()),
        savedAt: Date.now()
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[UserStore] Saved ${this.users.size} users`);
    } catch (err) {
      console.error('[UserStore] Save failed:', err.message);
    }
  }

  create(userData) {
    const user = new User(userData);
    this.users.set(user.id, user);
    this.save();
    return user;
  }

  get(userId) {
    return this.users.get(userId);
  }

  getByName(name) {
    for (const user of this.users.values()) {
      if (user.name === name) {
        return user;
      }
    }
    return null;
  }

  update(userId, updates) {
    const user = this.users.get(userId);
    if (!user) return null;

    if (updates.name !== undefined) user.name = updates.name;
    if (updates.birthday !== undefined) user.birthday = updates.birthday;
    if (updates.securityLevel !== undefined) user.securityLevel = updates.securityLevel;
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.preferences !== undefined) user.preferences = updates.preferences;
    if (updates.metadata !== undefined) user.metadata = updates.metadata;

    this.save();
    return user;
  }

  delete(userId) {
    const result = this.users.delete(userId);
    if (result) {
      this.save();
    }
    return result;
  }

  getAll() {
    return Array.from(this.users.values());
  }

  getByRole(role) {
    return this.getAll().filter(u => u.role === role);
  }

  getBySecurityLevel(level) {
    return this.getAll().filter(u => u.securityLevel === level);
  }

  createSession(userId, token, expiresAt) {
    this.sessions.set(token, {
      userId,
      createdAt: Date.now(),
      expiresAt
    });
  }

  getSession(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  deleteSession(token) {
    return this.sessions.delete(token);
  }

  cleanExpiredSessions() {
    const now = Date.now();
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }
}

class PermissionManager {
  constructor(options = {}) {
    this.userStore = options.userStore || null;
    this.permissionRules = new Map();
  }

  canAccessCapability(user, capability) {
    if (!user || !capability) return false;

    if (user.isAdmin()) return true;
    if (user.isManager()) return true;

    return user.securityLevel >= capability.securityLevel;
  }

  getAccessibleCapabilities(user, capabilities) {
    return capabilities.filter(cap => this.canAccessCapability(user, cap));
  }

  grantPermission(userId, capabilityId, grantedBy, expiresAt = null) {
    const key = `${userId}:${capabilityId}`;
    this.permissionRules.set(key, {
      userId,
      capabilityId,
      grantedBy,
      grantedAt: Date.now(),
      expiresAt
    });
  }

  revokePermission(userId, capabilityId) {
    const key = `${userId}:${capabilityId}`;
    return this.permissionRules.delete(key);
  }

  hasExplicitPermission(userId, capabilityId) {
    const key = `${userId}:${capabilityId}`;
    const rule = this.permissionRules.get(key);
    if (!rule) return false;
    if (rule.expiresAt && Date.now() > rule.expiresAt) {
      this.permissionRules.delete(key);
      return false;
    }
    return true;
  }

  getUserPermissions(userId) {
    const permissions = [];
    for (const [key, rule] of this.permissionRules) {
      if (rule.userId === userId) {
        permissions.push(rule);
      }
    }
    return permissions;
  }

  getAllPermissions() {
    return Array.from(this.permissionRules.values());
  }
}

module.exports = {
  User,
  UserStore,
  UserRole,
  SecurityLevel,
  PermissionManager
};
