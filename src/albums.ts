import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
import { formatDuration, spotifyFetch } from './utils.js';

// Spotify API response types
interface SpotifyAlbumArtist {
  name: string;
}

interface SpotifyAlbum {
  id: string;
  name: string;
  artists: SpotifyAlbumArtist[];
  release_date: string;
  album_type: string;
  total_tracks: number;
}

interface SpotifyAlbumTracksResponse {
  items: Array<{
    id: string;
    name: string;
    artists: SpotifyAlbumArtist[];
    duration_ms: number;
  }>;
  total: number;
}

const getAlbums: tool<{
  albumIds: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString>]>;
}> = {
  name: 'getAlbums',
  description:
    'Get detailed information about one or more albums by their Spotify IDs',
  schema: {
    albumIds: z
      .union([z.string(), z.array(z.string()).max(20)])
      .describe('A single album ID or array of album IDs (max 20)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds } = args;
    const ids = Array.isArray(albumIds) ? albumIds : [albumIds];

    if (ids.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      // Batch endpoints removed - fetch albums individually
      const albums: (SpotifyAlbum | null)[] = await Promise.all(
        ids.map(async (id) => {
          try {
            return await spotifyFetch<SpotifyAlbum>(`/albums/${id}`);
          } catch {
            return null;
          }
        }),
      );

      const validAlbums = albums.filter((a): a is SpotifyAlbum => a !== null);

      if (validAlbums.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No albums found for the provided IDs',
            },
          ],
        };
      }

      if (validAlbums.length === 1) {
        const album = validAlbums[0];
        const artists = album.artists.map((a) => a.name).join(', ');
        const releaseDate = album.release_date;
        const totalTracks = album.total_tracks;
        const albumType = album.album_type;

        return {
          content: [
            {
              type: 'text',
              text: `# Album Details\n\n**Name**: "${album.name}"\n**Artists**: ${artists}\n**Release Date**: ${releaseDate}\n**Type**: ${albumType}\n**Total Tracks**: ${totalTracks}\n**ID**: ${album.id}`,
            },
          ],
        };
      }

      const formattedAlbums = albums
        .map((album, i) => {
          if (!album) return `${i + 1}. [Album not found]`;

          const artists = album.artists.map((a) => a.name).join(', ');
          return `${i + 1}. "${album.name}" by ${artists} (${album.release_date}) - ${album.total_tracks} tracks - ID: ${album.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Multiple Albums\n\n${formattedAlbums}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getAlbumTracks: tool<{
  albumId: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getAlbumTracks',
  description: 'Get tracks from a specific album with pagination support',
  schema: {
    albumId: z.string().describe('The Spotify ID of the album'),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of tracks to return (1-50)'),
    offset: z
      .number()
      .min(0)
      .optional()
      .describe('Offset for pagination (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumId, limit = 20, offset = 0 } = args;

    try {
      const tracks = await spotifyFetch<SpotifyAlbumTracksResponse>(
        `/albums/${albumId}/tracks`,
        {
          params: { limit, offset },
        },
      );

      if (tracks.items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No tracks found in this album',
            },
          ],
        };
      }

      const formattedTracks = tracks.items
        .map((track, i) => {
          if (!track) return `${i + 1}. [Track not found]`;

          const artists = track.artists.map((a) => a.name).join(', ');
          const duration = formatDuration(track.duration_ms);
          return `${offset + i + 1}. "${track.name}" by ${artists} (${duration}) - ID: ${track.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Album Tracks (${offset + 1}-${offset + tracks.items.length} of ${tracks.total})\n\n${formattedTracks}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting album tracks: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const saveOrRemoveAlbumForUser: tool<{
  albumIds: z.ZodArray<z.ZodString>;
  action: z.ZodEnum<['save', 'remove']>;
}> = {
  name: 'saveOrRemoveAlbumForUser',
  description: 'Save or remove albums from the user\'s "Your Music" library',
  schema: {
    albumIds: z
      .array(z.string())
      .max(20)
      .describe('Array of Spotify album IDs (max 20)'),
    action: z
      .enum(['save', 'remove'])
      .describe('Action to perform: save or remove albums'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds, action } = args;

    if (albumIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      // Convert IDs to Spotify URIs for new /me/library endpoint
      const uris = albumIds.map((id) => `spotify:album:${id}`);

      await spotifyFetch('/me/library', {
        method: action === 'save' ? 'PUT' : 'DELETE',
        body: { uris },
      });

      const actionPastTense = action === 'save' ? 'saved' : 'removed';
      const preposition = action === 'save' ? 'to' : 'from';

      return {
        content: [
          {
            type: 'text',
            text: `Successfully ${actionPastTense} ${albumIds.length} album${albumIds.length === 1 ? '' : 's'} ${preposition} your library`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error ${action === 'save' ? 'saving' : 'removing'} albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const checkUsersSavedAlbums: tool<{
  albumIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'checkUsersSavedAlbums',
  description: 'Check if albums are saved in the user\'s "Your Music" library',
  schema: {
    albumIds: z
      .array(z.string())
      .max(20)
      .describe('Array of Spotify album IDs to check (max 20)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds } = args;

    if (albumIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      // Convert IDs to Spotify URIs for new /me/library/contains endpoint
      const uris = albumIds.map((id) => `spotify:album:${id}`).join(',');

      const savedStatus = await spotifyFetch<boolean[]>(
        '/me/library/contains',
        {
          params: { uris },
        },
      );

      const formattedResults = albumIds
        .map((albumId, i) => {
          const isSaved = savedStatus[i];
          return `${i + 1}. ${albumId}: ${isSaved ? 'Saved' : 'Not saved'}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Album Save Status\n\n${formattedResults}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking saved albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

export const albumTools = [
  getAlbums,
  getAlbumTracks,
  saveOrRemoveAlbumForUser,
  checkUsersSavedAlbums,
];
