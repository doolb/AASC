'use strict';

const TempPlaylistPreview = {
    createKey(item, index = 0) {
        if (item && item.tempPreviewKey) {
            return String(item.tempPreviewKey);
        }

        const fileName = String(item?.fileName || item?.name || '');
        const mediaType = String(item?.mediaType || 'image');
        const mimeType = String(item?.mimeType || '');
        const format = String(item?.format || '');
        const modifiedTime = String(item?.modifiedTime || '');
        const width = String(item?.width || '');
        const height = String(item?.height || '');

        return [index, fileName, mediaType, mimeType, format, modifiedTime, width, height].join('::');
    },

    buildServerOrderedFiles(playlist, cachedFiles) {
        const cachedList = Array.isArray(cachedFiles) ? cachedFiles : [];
        const cachedMap = new Map();

        cachedList.forEach((item, index) => {
            cachedMap.set(this.createKey(item, index), item);
        });

        return (Array.isArray(playlist) ? playlist : []).map((playlistItem, index) => {
            const tempPreviewKey = this.createKey(playlistItem, index);
            const cachedItem = cachedMap.get(tempPreviewKey);

            if (cachedItem) {
                return {
                    ...cachedItem,
                    tempPreviewKey
                };
            }

            return {
                ...playlistItem,
                tempPreviewKey
            };
        });
    },

    findCachedFile(cachedFiles, info) {
        const cachedList = Array.isArray(cachedFiles) ? cachedFiles : [];

        if (info?.tempPreviewKey) {
            const matchedItem = cachedList.find((item) => item.tempPreviewKey === info.tempPreviewKey);
            if (matchedItem) {
                return matchedItem;
            }
        }

        return cachedList[info?.index || 0];
    }
};

if (typeof window !== 'undefined') {
    window.TempPlaylistPreview = TempPlaylistPreview;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TempPlaylistPreview;
}
