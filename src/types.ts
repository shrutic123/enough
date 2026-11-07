export type Organization = { id: string; name: string }
export type Account = { id: string; email: string; name?: string; organizations: Organization[] }
export type SessionResponse = { connected: boolean; account?: Account; redirectUri?: string }
export type Channel = { id: string; name: string; displayName?: string; service: string; isDisconnected?: boolean; isQueuePaused?: boolean }
export type ChannelsResponse = { channels: Channel[] }
export type PostStatus = 'draft' | 'error' | 'needs_approval' | 'scheduled' | 'sending' | 'sent'
export type CardAsset = { thumbnail: string; source: string; type: string }
export type QueueCard = {
  id: string
  text: string
  channelId: string
  channelName: string
  service: string
  dueAt: string | null
  status: PostStatus
  asset?: CardAsset | null
}
export type QueueResponse = { posts: QueueCard[] }

export type EssenceKind = 'scheduled' | 'draft'
export type SchedulingType = 'automatic' | 'notification'
export type TrimResponse = { trimmed: string }
export type CreateEssenceRequest = {
  kind: EssenceKind
  text: string
  channelId: string
  organizationId: string
  imageUrl?: string
}
export type CreatedPost = {
  id: string
  text: string
  status: PostStatus
  dueAt: string | null
  channelId: string
  schedulingType?: SchedulingType
}
export type CreateEssenceResponse = { post: CreatedPost }
