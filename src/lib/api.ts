import type {
  ChannelsResponse,
  CreateEssenceRequest,
  CreateEssenceResponse,
  QueueResponse,
  SessionResponse,
  TrimResponse,
} from '../types'

const FALLBACK = "Buffer didn't respond. Your queue is unchanged. Try again."

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    })
  } catch {
    throw new Error(FALLBACK)
  }

  const data: unknown = await response.json().catch(() => null)

  const serverError =
    data !== null && typeof data === 'object' && 'error' in data
      ? (data as { error?: unknown }).error
      : undefined

  if (!response.ok || serverError !== undefined) {
    throw new Error(typeof serverError === 'string' && serverError ? serverError : FALLBACK)
  }

  return data as T
}

export function getSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/api/buffer/session')
}

export function getChannels(organizationId: string): Promise<ChannelsResponse> {
  return request<ChannelsResponse>(`/api/buffer/channels?organizationId=${encodeURIComponent(organizationId)}`)
}

export function getQueue(organizationId: string): Promise<QueueResponse> {
  return request<QueueResponse>(`/api/buffer/queue?organizationId=${encodeURIComponent(organizationId)}`)
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' })
}

export function cutPost(postId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/buffer/cut', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId }),
  })
}

export function trimEssence(text: string): Promise<TrimResponse> {
  return request<TrimResponse>('/api/ai/essence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export function createEssencePost(input: CreateEssenceRequest): Promise<CreateEssenceResponse> {
  return request<CreateEssenceResponse>('/api/buffer/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
