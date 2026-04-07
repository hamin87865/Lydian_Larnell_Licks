import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { createPurchase, fetchContentDetail, type ContentItem } from "@/lib/appApi";

export default function Payment() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [content, setContent] = useState<ContentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const contentId = window.location.pathname.split("/payment/")[1];

  useEffect(() => {
    const loadContent = async () => {
      try {
        const response = await fetchContentDetail(contentId);
        setContent(response.content);
      } catch (error) {
        console.error("결제 정보 로딩 실패", error);
      } finally {
        setLoading(false);
      }
    };

    void loadContent();
  }, [contentId]);

  const handlePayment = async () => {
    if (!user || !content) {
      navigate("/login");
      return;
    }

    await createPurchase(content.id, user.id);
    alert("구매가 완료되었습니다.");
    navigate(`/content/${content.id}`);
  };

  if (loading) {
    return <main className="min-h-screen bg-background pt-32 text-white flex items-center justify-center">로딩 중...</main>;
  }

  if (!content) {
    return <main className="min-h-screen bg-background pt-32 text-white flex items-center justify-center">콘텐츠를 찾을 수 없습니다.</main>;
  }

  return (
    <main className="min-h-screen bg-background text-foreground pt-32">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="container mx-auto max-w-xl px-6 pb-12"
      >
        <div className="rounded-lg border border-white/10 bg-card p-8">
          <h1 className="mb-8 text-4xl font-display font-bold text-white">결제</h1>
          <div className="space-y-4 text-white">
            <div>
              <p className="text-sm text-gray-400">콘텐츠</p>
              <p className="text-lg font-semibold">{content.title}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">뮤지션</p>
              <p className="text-lg font-semibold">{content.authorName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">결제 금액</p>
              <p className="text-2xl font-bold text-primary">₩{Number(content.pdfPrice || 0).toLocaleString()}</p>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <Button onClick={handlePayment} className="flex-1 rounded py-3 font-bold text-white hover:bg-primary/90">
              결제하기
            </Button>
            <Button onClick={() => navigate(`/content/${content.id}`)} className="flex-1 rounded bg-gray-700 py-3 font-bold text-white hover:bg-gray-600">
              취소
            </Button>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
