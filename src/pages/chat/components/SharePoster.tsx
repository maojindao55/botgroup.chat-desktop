import { useRef, useEffect, useState } from 'react';
import domtoimage from 'dom-to-image';
import { Modal, Button } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { toast } from 'sonner';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { useUserStore } from '@/store/userStore';

interface PosterMessage {
  id: number | string;
  sender: { id?: string; name: string; avatar?: string };
  content: string;
  isAI?: boolean;
  isError?: boolean;
}

interface SharePosterProps {
  messages: PosterMessage[];
  onClose: () => void;
}

export function SharePoster({ messages, onClose }: SharePosterProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [posterImage, setPosterImage] = useState<string>('');
  const [generating, setGenerating] = useState(true);
  const userStore = useUserStore();
  const userName = userStore.userInfo?.nickname || '我';

  useEffect(() => {
    generatePoster();
  }, []);

  const generatePoster = async () => {
    const node = previewRef.current;
    if (!node) return;
    try {
      await document.fonts.ready;
      // Wait one frame so the offscreen preview lays out.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      // Preload remote images as base64 to avoid CORS taint during capture.
      const imgs = Array.from(node.getElementsByTagName('img'));
      await Promise.all(imgs.map(async (img) => {
        if (img.src.startsWith('data:')) return;
        try {
          const resp = await fetch(img.src, { mode: 'cors', credentials: 'omit' });
          const blob = await resp.blob();
          const dataUrl: string = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          img.src = dataUrl;
        } catch (e) {
          console.warn('图片预处理失败:', e);
        }
      }));

      const dataUrl = await domtoimage.toSvg(node, {
        bgcolor: '#f3f4f6',
        quality: 1.0,
      });
      setPosterImage(dataUrl);
    } catch (error) {
      console.error('生成海报失败:', error);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!posterImage) return;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = posterImage;
      });
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建canvas上下文');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png', 1.0);
      });

      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && navigator.share) {
        await navigator.share({
          files: [new File([blob], 'chat-history.png', { type: 'image/png' })],
          title: '聊天记录',
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chat-history.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('转换图片失败:', error);
      toast.error('保存图片失败，请重试');
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title="分享聊天记录"
      width="50vw"
      style={{ maxWidth: '95vw' }}
      footer={
        <Button type="primary" onClick={handleDownload} disabled={!posterImage}
          style={{ background: '#ff6600', borderColor: '#ff6600' }}>
          保存聊天海报
        </Button>
      }
      styles={{ body: { maxHeight: '70vh', overflow: 'auto', background: '#f3f4f6', padding: 16 } }}
    >
      {/* Offscreen preview that gets captured. Stays mounted but invisible until image is ready. */}
      <div
        ref={previewRef}
        style={{
          padding: 16,
          background: '#f3f4f6',
          width: 640,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: posterImage ? 'absolute' : 'relative',
          left: posterImage ? -99999 : undefined,
          top: posterImage ? -99999 : undefined,
        }}
      >
        {messages.map((m) => {
          const isUser = m.sender.name === userName;
          const a = getAvatarData(m.sender.name);
          const url = resolveAvatarByName(m.sender.name, m.sender.avatar);
          return (
            <div key={m.id} style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              justifyContent: isUser ? 'flex-end' : 'flex-start',
            }}>
              {!isUser && (
                <LobeAvatar avatar={url || a.text} background={a.backgroundColor} size={36} />
              )}
              <div style={{ maxWidth: '75%' }}>
                <div style={{ fontSize: 12, color: '#6b7280', padding: '0 4px', marginBottom: 4, textAlign: isUser ? 'right' : 'left' }}>
                  {m.sender.name}
                </div>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 16,
                  borderTopRightRadius: isUser ? 4 : 16,
                  borderTopLeftRadius: isUser ? 16 : 4,
                  background: isUser ? 'linear-gradient(to top right, #f97316, #f59e0b)' : '#fff',
                  color: isUser ? '#fff' : '#111',
                  border: isUser ? 'none' : '1px solid #e5e7eb',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}>
                  {m.content}
                </div>
              </div>
              {isUser && (
                <LobeAvatar avatar={url || a.text} background={a.backgroundColor} size={36} />
              )}
            </div>
          );
        })}
      </div>

      {/* Rendered poster image (visible once ready) */}
      {generating && !posterImage && (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
          正在生成海报...
        </div>
      )}
      {posterImage && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <img
            src={posterImage}
            alt="Share Poster"
            style={{
              maxWidth: '100%',
              height: 'auto',
              objectFit: 'contain',
              imageRendering: 'crisp-edges',
            }}
          />
        </div>
      )}
    </Modal>
  );
}

export default SharePoster;
