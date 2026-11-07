export type Organization = { id: string; name: string }
export type Account = { id: string; email: string; name?: string; organizations: Organization[] }
export type SessionResponse = { connected: boolean; account?: Account; redirectUri?: string }
export type Channel = { id: string; name: string; displayName?: string; service: string; isDisconnected?: boolean; isQueuePaused?: boolean }
export type ChannelsResponse = { channels: Channel[] }
export type PostStatus = 'draft' | 'error' | 'needs_approval' | 'scheduled' | 'sending' | 'sent'
export type QueueCard = { id: string; text: string; channelId: string; channelName: string; service: string; dueAt: string | null; status: PostStatus }
export type QueueResponse = { posts: QueueCard[] }
