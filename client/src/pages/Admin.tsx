import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { approveApplication, deleteMusicianByAdmin, fetchAdminDashboard, getAdminContractDownloadUrl, rejectApplication, type MusicianApplication, type UserSettings } from "@/lib/appApi";

interface ContentItem {
  id: string;
  authorId: string;
  isSanctioned?: boolean;
}

export default function Admin() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const [applications, setApplications] = useState<MusicianApplication[]>([]);
  const [processedApplications, setProcessedApplications] = useState<MusicianApplication[]>([]);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [expandedProcessed, setExpandedProcessed] = useState<string | null>(null);
  const [allSettings, setAllSettings] = useState<Record<string, UserSettings>>({});
  const [allContents, setAllContents] = useState<ContentItem[]>([]);

  const loadData = async () => {
    const data = await fetchAdminDashboard();
    setApplications(data.applications);
    setProcessedApplications(data.processedApplications);
    setAllSettings(data.settings);
    setAllContents(data.contents);
  };

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "admin") {
      navigate("/");
      return;
    }

    void loadData();
  }, [isAuthenticated, navigate, user?.role]);

  const getDisplayNickname = (userId: string, fallback: string) => {
    return allSettings[userId]?.nickname || fallback;
  };

  const getSanctionedCount = (userId: string) => {
    return allContents.filter(
      (content) => content.authorId === userId && content.isSanctioned,
    ).length;
  };

  const sortedProcessedApplications = useMemo(() => {
    const copied = [...processedApplications];

    copied.sort((a, b) => {
      const aSanctionCount = getSanctionedCount(a.userId);
      const bSanctionCount = getSanctionedCount(b.userId);

      const aPriority = aSanctionCount >= 2 ? 1 : 0;
      const bPriority = bSanctionCount >= 2 ? 1 : 0;

      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return copied;
  }, [processedApplications, allContents]);

  const approveRequest = async (app: MusicianApplication) => {
    await approveApplication(app.id, user?.id);
    await loadData();
  };

  const rejectRequest = async (app: MusicianApplication) => {
    await rejectApplication(app.id, user?.id);
    await loadData();
  };

  const deleteMusicianAccount = async (app: MusicianApplication) => {
    if (!window.confirm("정말 계정을 삭제하시겠습니까?")) return;
    await deleteMusicianByAdmin(app.userId);
    await loadData();
  };

  return (
    <main className="min-h-screen bg-background text-foreground pt-32">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="container mx-auto px-6 max-w-4xl pb-12"
      >
        <div className="bg-card border border-white/10 rounded-lg p-8">
          <h1 className="text-4xl font-display font-bold mb-8 text-white">관리자 대시보드</h1>

          <div className="space-y-12">
            <section>
              <h2 className="text-2xl font-bold mb-4">뮤지션 지원서 관리</h2>

              {applications.length === 0 ? (
                <div className="bg-background rounded p-4 text-gray-400">
                  <p>대기 중인 지원서가 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {applications.map((app) => {
                    const displayNickname = getDisplayNickname(app.userId, app.nickname);

                    return (
                      <div key={app.id} className="bg-background border border-white/10 rounded-lg overflow-hidden">
                        <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-white/5" onClick={() => setExpandedApp(expandedApp === app.id ? null : app.id)}>
                          <div>
                            <h3 className="text-white font-bold text-lg">
                              {app.name} <span className="text-sm text-blue-500 font-normal">({displayNickname})</span>
                            </h3>
                            <p className="text-white text-sm font-semibold mt-1">지원 분야: {app.category}</p>
                          </div>
                          <div className="text-sm text-gray-400">{expandedApp === app.id ? "접기 ▲" : "지원서 확인 ▼"}</div>
                        </div>

                        {expandedApp === app.id && (
                          <div className="p-4 border-t border-white/10 bg-black/20">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div><p className="text-xs text-gray-500 mb-1">이름</p><p className="text-white text-sm">{app.name}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">닉네임</p><p className="text-white text-sm">{displayNickname}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">카테고리</p><p className="text-white text-sm">{app.category}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">이메일</p><p className="text-white text-sm">{app.email}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">은행</p><p className="text-white text-sm">{app.bankName || "-"}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">계좌번호</p><p className="text-white text-sm">{app.accountNumber || "-"}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">예금주명</p><p className="text-white text-sm">{app.accountHolder || "-"}</p></div>
                            </div>

                            <div className="mb-6">
                              <p className="text-xs text-gray-500 mb-2">지원 영상</p>
                              {app.videoPath ? <video controls className="w-full max-h-64 bg-black rounded" src={app.videoPath} /> : <div className="p-4 bg-gray-800 rounded flex flex-col items-center justify-center text-center"><p className="text-gray-300 text-sm mb-1">{app.videoFileName}</p><p className="text-red-400 text-xs mt-2">영상 경로가 없습니다.</p></div>}
                            </div>

                            <div className="mb-6">
                              <p className="text-xs text-gray-500 mb-2">계약서</p>
                              {app.signedContractPath ? (
                                <a href={getAdminContractDownloadUrl(app.id)} download={app.signedContractFileName || "signed-contract.pdf"} className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-blue-300 hover:bg-white/10 transition-colors">
                                  계약서 다운로드{app.signedContractFileName ? ` (${app.signedContractFileName})` : ""}
                                </a>
                              ) : <p className="text-gray-400 text-xs">계약서 없음</p>}
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-white/10">
                              <Button onClick={() => approveRequest(app)} className="flex-1 bg-green-600 hover:bg-green-500/90 text-white font-bold py-2 rounded transition-colors">승인</Button>
                              <Button onClick={() => rejectRequest(app)} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded transition-colors">거절</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4">뮤지션 관리</h2>

              {sortedProcessedApplications.length === 0 ? (
                <div className="bg-background rounded p-4 text-gray-400"><p>처리된 뮤지션 내역이 없습니다.</p></div>
              ) : (
                <div className="space-y-4">
                  {sortedProcessedApplications.map((app) => {
                    const displayNickname = getDisplayNickname(app.userId, app.nickname);
                    const sanctionedCount = getSanctionedCount(app.userId);
                    const isPriorityMusician = sanctionedCount >= 2;

                    return (
                      <div key={app.id} className={`bg-background rounded-lg overflow-hidden border ${isPriorityMusician ? "border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]" : "border-white/10"}`}>
                        <div className={`p-4 flex justify-between items-center cursor-pointer transition-colors ${isPriorityMusician ? "hover:bg-red-500/5" : "hover:bg-white/5"}`} onClick={() => setExpandedProcessed(expandedProcessed === app.id ? null : app.id)}>
                          <div className="min-w-0">
                            <h3 className="text-white font-bold text-lg">
                              {app.name}{" "}
                              <span onClick={(e) => { e.stopPropagation(); navigate(`/musician-profile/${app.userId}`); }} className={`text-sm font-normal cursor-pointer hover:underline ${isPriorityMusician ? "text-red-300" : "text-blue-500"}`}>
                                ({displayNickname})
                              </span>
                            </h3>
                            <p className="text-white text-sm font-semibold mt-1">지원 분야: {app.category}</p>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="flex items-center"><p className={`text-sm font-semibold ${isPriorityMusician ? "text-red-300" : "text-white"}`}>제재 영상 개수: {sanctionedCount}개</p></div>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${app.status === "approved" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{app.status === "approved" ? "승인완료" : "거절"}</span>
                            <div className="text-sm text-gray-400">{expandedProcessed === app.id ? "접기 ▲" : "지원서 확인 ▼"}</div>
                          </div>
                        </div>

                        {expandedProcessed === app.id && (
                          <div className="p-4 border-t border-white/10 bg-black/20">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div><p className="text-xs text-gray-500 mb-1">이름</p><p className="text-white text-sm">{app.name}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">닉네임</p><p className="text-white text-sm">{displayNickname}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">카테고리</p><p className="text-white text-sm">{app.category}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">이메일</p><p className="text-white text-sm">{app.email}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">은행</p><p className="text-white text-sm">{app.bankName || "-"}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">계좌번호</p><p className="text-white text-sm">{app.accountNumber || "-"}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">예금주명</p><p className="text-white text-sm">{app.accountHolder || "-"}</p></div>
                              <div><p className="text-xs text-gray-500 mb-1">제재 영상 개수</p><p className={`${isPriorityMusician ? "text-red-300" : "text-white"} text-sm font-semibold`}>{sanctionedCount}개</p></div>
                            </div>

                            <div className="mb-6">
                              <p className="text-xs text-gray-500 mb-2">지원 영상</p>
                              {app.videoPath ? <video controls className="w-full max-h-64 bg-black rounded" src={app.videoPath} /> : <div className="p-4 bg-gray-800 rounded flex flex-col items-center justify-center text-center"><p className="text-gray-300 text-sm mb-1">{app.videoFileName}</p><p className="text-gray-500 text-xs mt-2">영상 경로가 없습니다.</p></div>}
                            </div>

                            <div className="mb-2">
                              <p className="text-xs text-gray-500 mb-2">계약서</p>
                              {app.signedContractPath ? <a href={getAdminContractDownloadUrl(app.id)} download={app.signedContractFileName || "signed-contract.pdf"} className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-blue-300 hover:bg-white/10 transition-colors">계약서 다운로드{app.signedContractFileName ? ` (${app.signedContractFileName})` : ""}</a> : <p className="text-gray-400 text-sm">계약서 없음</p>}
                            </div>

                            {isPriorityMusician && (
                              <div className="pt-4 border-t border-white/10 mt-4">
                                <Button onClick={() => deleteMusicianAccount(app)} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded transition-colors">계정 삭제</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
