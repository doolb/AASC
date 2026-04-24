const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');

class MediaLibraryActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'media-library-handler',
      capabilities: [
        {
          id: 'media-library',
          name: '媒体库管理',
          category: CapabilityCategory.SPECIAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '多源媒体库管理能力，支持本地、HTTP、SMB等多种媒体源'
        },
        {
          id: 'media-upload',
          name: '媒体上传',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 1,
          description: '媒体文件上传能力'
        },
        {
          id: 'media-search',
          name: '媒体搜索',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '媒体文件搜索能力'
        }
      ],
      subscriptions: [MessageTopic.MEDIA_CONTROL, 'media.library'],
      ...options
    });

    this.manager = options.manager || null;
  }

  setManager(manager) {
    this.manager = manager;
  }

  async onInit() {
    this.registerHandler('media.library', this.handleLibrary.bind(this));
    this.registerHandler('media.library.list', this.handleListLibraries.bind(this));
    this.registerHandler('media.library.get', this.handleGetLibrary.bind(this));
    this.registerHandler('media.library.add', this.handleAddLibrary.bind(this));
    this.registerHandler('media.library.remove', this.handleRemoveLibrary.bind(this));
    this.registerHandler('media.library.setDefault', this.handleSetDefault.bind(this));
    this.registerHandler('media.library.files', this.handleListFiles.bind(this));
    this.registerHandler('media.library.upload', this.handleUpload.bind(this));
    this.registerHandler('media.library.delete', this.handleDelete.bind(this));
    this.registerHandler('media.library.createFolder', this.handleCreateFolder.bind(this));
    this.registerHandler('media.library.deleteFolder', this.handleDeleteFolder.bind(this));
    this.registerHandler('media.library.search', this.handleSearch.bind(this));
  }

  async handleLibrary(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'list':
        return this.handleListLibraries(message);
      case 'get':
        return this.handleGetLibrary(message);
      case 'add':
        return this.handleAddLibrary(message);
      case 'remove':
        return this.handleRemoveLibrary(message);
      case 'setDefault':
        return this.handleSetDefault(message);
      case 'files':
        return this.handleListFiles(message);
      case 'upload':
        return this.handleUpload(message);
      case 'delete':
        return this.handleDelete(message);
      case 'createFolder':
        return this.handleCreateFolder(message);
      case 'deleteFolder':
        return this.handleDeleteFolder(message);
      case 'search':
        return this.handleSearch(message);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  async handleListLibraries(message) {
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const libraries = this.manager.listLibraries();
      return { success: true, data: libraries };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleGetLibrary(message) {
    const { libraryId } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const library = this.manager.getLibrary(libraryId);
      if (!library) {
        return { success: false, error: `Library not found: ${libraryId}` };
      }
      return { 
        success: true, 
        data: {
          id: libraryId,
          name: library.config.name,
          type: library.config.type,
          readonly: library.config.readonly || false
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleAddLibrary(message) {
    const { config } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const result = await this.manager.addLibraryFromConfig(config);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleRemoveLibrary(message) {
    const { libraryId } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      await this.manager.removeLibrary(libraryId);
      this.manager.saveConfig();
      return { success: true, data: { id: libraryId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleSetDefault(message) {
    const { libraryId } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      this.manager.setDefault(libraryId);
      return { success: true, data: { defaultId: libraryId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleListFiles(message) {
    const { libraryId, dirPath } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const targetId = libraryId || this.manager.getDefaultLibraryId();
      if (!targetId) {
        return { success: false, error: 'No library available' };
      }
      
      const files = await this.manager.list(targetId, dirPath || '/');
      return { success: true, data: { libraryId: targetId, files } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleUpload(message) {
    const { libraryId, dirPath, file } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const targetId = libraryId || this.manager.getDefaultLibraryId();
      const result = await this.manager.upload(targetId, dirPath || '/', file);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleDelete(message) {
    const { libraryId, filePath } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const targetId = libraryId || this.manager.getDefaultLibraryId();
      await this.manager.delete(targetId, filePath);
      return { success: true, data: { path: filePath } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleCreateFolder(message) {
    const { libraryId, dirPath, name } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const targetId = libraryId || this.manager.getDefaultLibraryId();
      const result = await this.manager.createFolder(targetId, dirPath, name);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleDeleteFolder(message) {
    const { libraryId, folderPath } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    try {
      const targetId = libraryId || this.manager.getDefaultLibraryId();
      await this.manager.deleteFolder(targetId, folderPath);
      return { success: true, data: { path: folderPath } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleSearch(message) {
    const { keyword, libraryId } = message.payload.data || message.payload;
    
    if (!this.manager) {
      return { success: false, error: 'Media library manager not configured' };
    }

    if (!keyword) {
      return { success: false, error: 'Search keyword is required' };
    }

    try {
      const matches = [];
      const keywordLower = keyword.toLowerCase();
      
      const libraries = libraryId 
        ? [this.manager.getLibrary(libraryId)].filter(Boolean)
        : this.manager.listLibraries();
      
      for (const lib of libraries) {
        const items = await this._searchInLibrary(lib.id, keywordLower);
        matches.push(...items);
      }
      
      return { success: true, data: { keyword, matches, total: matches.length } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _searchInLibrary(libraryId, keyword) {
    const matches = [];
    
    const searchDir = async (dirPath) => {
      try {
        const items = await this.manager.list(libraryId, dirPath);
        
        for (const item of items) {
          if (item.type === 'folder') {
            await searchDir(item.path);
          } else if (item.type === 'file') {
            const nameLower = item.name.toLowerCase();
            if (nameLower.includes(keyword)) {
              matches.push({
                name: item.name,
                path: item.path,
                url: item.url,
                mediaType: item.mediaType,
                libraryId: libraryId
              });
            }
          }
        }
      } catch (err) {
        console.error(`[MediaLibraryActor] 搜索目录 ${dirPath} 失败:`, err.message);
      }
    };
    
    await searchDir('/');
    return matches;
  }
}

module.exports = MediaLibraryActor;
