import { useCallback, useState } from 'react';
import { IonContent, IonPage, IonRefresher, IonRefresherContent, IonToast, useIonViewWillEnter } from '@ionic/react';
import {
  deleteGalleryItem,
  listGalleryItems,
  type GalleryItem,
} from '../services/galleryLibrary';
import { videoGeneratorService } from '../services/videoGeneratorService';
import { AppHeader, GalleryVideoThumb, StatusShareSheet, useTrial } from '../ui';
import './Gallery.css';

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const Gallery: React.FC = () => {
  const { shouldShowAds } = useTrial();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shareUri, setShareUri] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listGalleryItems();
      setItems(list);
    } catch (err) {
      console.warn('[Gallery] list failed', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useIonViewWillEnter(() => {
    void refresh();
  });

  const onShare = (item: GalleryItem) => {
    setShareUri(item.uri);
    setShareOpen(true);
  };

  const onPostToStatus = async () => {
    if (!shareUri) return;
    setShareBusy(true);
    try {
      const shared = await videoGeneratorService.shareToWhatsAppStatus(shareUri);
      setShareOpen(false);
      setToast({
        open: true,
        message: shared ? 'Opened WhatsApp Status' : 'Share unavailable',
      });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not share',
      });
    } finally {
      setShareBusy(false);
    }
  };

  const onBestQuality = async () => {
    if (!shareUri) return;
    setShareBusy(true);
    try {
      const shared = await videoGeneratorService.shareViaHdChatThenStatus(shareUri);
      setShareOpen(false);
      setToast({
        open: true,
        message: shared
          ? 'Send with HD, then Forward → My Status'
          : 'Share unavailable',
      });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not share',
      });
    } finally {
      setShareBusy(false);
    }
  };

  const onShareToFolder = async () => {
    if (!shareUri) return;
    setShareBusy(true);
    try {
      const shared = await videoGeneratorService.shareForPcOrNetwork(shareUri);
      setShareOpen(false);
      setToast({
        open: true,
        message: shared
          ? 'Saved path ready — open on PC → web.whatsapp.com'
          : 'Share unavailable',
      });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not share',
      });
    } finally {
      setShareBusy(false);
    }
  };

  const onDelete = async (item: GalleryItem) => {
    setBusyId(item.id);
    try {
      await deleteGalleryItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setToast({ open: true, message: 'Removed from gallery' });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not delete',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <IonPage>
      <IonContent
        fullscreen
        className={`gallery-content${shouldShowAds ? ' gallery-content--with-ads' : ''}`}
      >
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e) => {
            await refresh();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <AppHeader />
        <div className="gallery-body">
          <div className="gallery-heading-row">
            <h2 className="gallery-heading">Gallery</h2>
            <span className="font-label-sm gallery-count">
              {loading ? '…' : `${items.length} SAVED`}
            </span>
          </div>

          {!loading && items.length === 0 ? (
            <div className="gallery-empty glass-card">
              <span className="material-symbols-outlined gallery-empty-icon" aria-hidden>
                grid_view
              </span>
              <h2 className="gallery-empty-title">No exports yet</h2>
              <p className="gallery-empty-copy">
                Convert a video on Home — it is saved to your phone and listed here.
              </p>
            </div>
          ) : (
            <div className="gallery-grid">
              {items.map((item) => (
                <article key={item.id} className="gallery-card glass-card">
                  <div className="gallery-thumb">
                    <GalleryVideoThumb uri={item.uri} alt={item.title} />
                    <span className="gallery-badge font-label-sm">{item.statusLengthSec}s</span>
                  </div>
                  <div className="gallery-meta">
                    <p className="gallery-title">{item.title}</p>
                    <p className="gallery-sub font-label-sm">
                      {formatDate(item.createdAt)}
                      {item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ''}
                    </p>
                  </div>
                  <div className="gallery-actions">
                    <button
                      type="button"
                      className="gallery-btn gallery-btn--primary"
                      disabled={busyId === item.id}
                      onClick={() => void onShare(item)}
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        share
                      </span>
                      Share
                    </button>
                    <button
                      type="button"
                      className="gallery-btn gallery-btn--ghost"
                      disabled={busyId === item.id}
                      onClick={() => void onDelete(item)}
                      aria-label="Delete"
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        delete
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <StatusShareSheet
          open={shareOpen}
          fileUri={shareUri}
          busy={shareBusy}
          onDismiss={() => setShareOpen(false)}
          onPostToStatus={onPostToStatus}
          onBestQuality={onBestQuality}
          onShareToFolder={onShareToFolder}
        />

        <IonToast
          className="eh-toast"
          isOpen={toast.open}
          message={toast.message}
          duration={2800}
          position="bottom"
          positionAnchor={shouldShowAds ? 'app-ad-footer' : 'app-tab-bar'}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
        />
      </IonContent>
    </IonPage>
  );
};

export default Gallery;
