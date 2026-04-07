import { apiRequest, fetchJson } from "./queryClient";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: "basic" | "musician" | "admin";
  upgradeRequestStatus: "none" | "pending" | "approved" | "rejected";
};

export type ContentItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string;
  videoUrl: string;
  videoFile?: string;
  pdfFile?: string;
  pdfFileName?: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  pdfPrice?: number;
  isSanctioned?: boolean;
  sanctionReason?: string;
  sanctionedAt?: string;
};

export type UserSettings = {
  nickname?: string;
  profileImage?: string;
  bio?: string;
  email?: string;
  instagram?: string;
  layout?: "horizontal" | "vertical";
  language?: "ko" | "en";
  notificationsEnabled?: boolean;
  lastNicknameChange?: number | null;
};

export type SubscriptionItem = {
  targetId: string;
  notify: boolean;
  name?: string;
};

export type MusicianApplication = {
  id: string;
  userId: string;
  name: string;
  nickname: string;
  category: string;
  email: string;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  videoFileName: string;
  videoSize?: number;
  videoPath?: string;
  signedContractPath?: string;
  signedContractFileName?: string;
  signedContractSize?: number;
  contractChecked?: boolean;
  createdAt: string;
  status: string;
};

export async function fetchCurrentUser(): Promise<AppUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });

  if (res.status === 401) {
    return null;
  }

  if (!res.ok) {
    throw new Error("사용자 정보를 불러오지 못했습니다.");
  }

  const data = await res.json();
  return data.user as AppUser;
}

export async function signupUser(email: string, password: string, name: string) {
  const res = await apiRequest("POST", "/api/auth/signup", { email, password, name });
  const data = await res.json();
  return data.user as AppUser;
}

export async function loginUser(email: string, password: string) {
  const res = await apiRequest("POST", "/api/auth/login", { email, password });
  const data = await res.json();
  return data.user as AppUser;
}

export async function logoutUser() {
  await apiRequest("POST", "/api/auth/logout");
}

export async function fetchCategoryContents(category: string) {
  const query = new URLSearchParams({ category }).toString();
  return fetchJson<{ contents: ContentItem[]; authorNicknames: Record<string, string> }>(`/api/contents?${query}`);
}

export async function fetchContentDetail(contentId: string) {
  return fetchJson<{ content: ContentItem | null; hasPurchased: boolean }>(`/api/contents/${contentId}`);
}

export async function fetchMySettings() {
  return fetchJson<{ settings: UserSettings }>("/api/users/me/settings");
}

export async function fetchMyContents() {
  return fetchJson<{ contents: ContentItem[] }>("/api/users/me/contents");
}

export async function fetchMySubscriptions() {
  return fetchJson<{ subscriptions: SubscriptionItem[] }>("/api/subscriptions");
}

export async function fetchMusicianProfile(targetId: string) {
  return fetchJson<{
    user: AppUser | null;
    settings: UserSettings;
    contents: ContentItem[];
    subscription: { subscribed: boolean; notify: boolean };
  }>(`/api/users/${targetId}/profile`);
}

export async function fetchAdminDashboard() {
  return fetchJson<{
    applications: MusicianApplication[];
    processedApplications: MusicianApplication[];
    settings: Record<string, UserSettings>;
    contents: Array<{ id: string; authorId: string; isSanctioned?: boolean }>;
  }>("/api/admin/dashboard");
}

export async function saveMySettings(payload: Record<string, any> | FormData, _currentUserId?: string) {
  await apiRequest("PUT", "/api/users/me/settings", payload);
}

export async function submitMusicianApplication(payload: Record<string, any> | FormData, _currentUserId: string) {
  const res = await apiRequest("POST", "/api/applications", payload);
  return res.json();
}

export async function approveApplication(id: string, _currentUserId?: string) {
  await apiRequest("POST", `/api/admin/applications/${id}/approve`);
}

export async function rejectApplication(id: string, _currentUserId?: string) {
  await apiRequest("POST", `/api/admin/applications/${id}/reject`);
}

export async function deleteMusicianByAdmin(userId: string) {
  await apiRequest("DELETE", `/api/admin/users/${userId}`);
}

export async function sanctionContentById(id: string, reason: string, _currentUserId?: string) {
  await apiRequest("POST", `/api/admin/contents/${id}/sanction`, { reason });
}

export async function unsanctionContentById(id: string, _currentUserId?: string) {
  await apiRequest("POST", `/api/admin/contents/${id}/unsanction`);
}

export async function createContent(payload: Record<string, any> | FormData, _currentUserId: string) {
  const res = await apiRequest("POST", "/api/contents", payload);
  return res.json();
}

export async function deleteContentById(id: string, _currentUserId: string) {
  await apiRequest("DELETE", `/api/contents/${id}`);
}

export async function toggleSubscription(targetId: string, _currentUserId: string) {
  const res = await apiRequest("POST", "/api/subscriptions/toggle", { targetId });
  return (await res.json()) as { subscribed: boolean; notify: boolean };
}

export async function updateSubscriptionNotify(targetId: string, notify: boolean, _currentUserId: string) {
  await apiRequest("POST", "/api/subscriptions/notify", { targetId, notify });
}

export async function createPurchase(contentId: string, _currentUserId: string) {
  await apiRequest("POST", "/api/purchases", { contentId });
}

export async function deleteMyAccount(reason: string) {
  await apiRequest("DELETE", "/api/users/me", { reason });
}


export function getProtectedPdfDownloadUrl(contentId: string) {
  return `/api/contents/${contentId}/pdf-download`;
}

export function getAdminContractDownloadUrl(applicationId: string) {
  return `/api/admin/applications/${applicationId}/contract-download`;
}
