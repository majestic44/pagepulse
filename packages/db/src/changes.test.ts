import { describe, expect, it, vi } from 'vitest';

import {
  ChangeReviewConflictError,
  listOwnedChangeReviews,
  resolveOwnedChangeReview,
} from './changes.js';

const review = {
  createdAt: new Date('2026-08-25T12:00:00.000Z'),
  currentSnapshotId: 'current-snapshot',
  currentStorageKey: 'monitor-id/current-snapshot.json',
  id: 'change-id',
  monitorId: 'monitor-id',
  monitorName: 'Career openings',
  previousSnapshotId: 'previous-snapshot',
  previousStorageKey: 'monitor-id/previous-snapshot.json',
  reviewedAt: null,
  state: 'pending',
  summary: 'Extracted content changed',
};

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as never;
}

describe('change reviews', () => {
  it('lists reviews only through the requesting monitor owner', async () => {
    const query = vi.fn().mockResolvedValue([[review], []]);

    await expect(listOwnedChangeReviews(connection(query), 'member-id')).resolves.toEqual([
      {
        createdAt: review.createdAt,
        current: { id: review.currentSnapshotId, storageKey: review.currentStorageKey },
        id: review.id,
        monitor: { id: review.monitorId, name: review.monitorName },
        previous: { id: review.previousSnapshotId, storageKey: review.previousStorageKey },
        reviewedAt: null,
        state: 'pending',
        summary: review.summary,
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('monitors.owner_id = ?'), [
      'member-id',
    ]);
  });

  it('atomically resolves a pending review for its monitor owner', async () => {
    const resolved = {
      ...review,
      reviewedAt: new Date('2026-08-25T12:01:00.000Z'),
      state: 'expected',
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[resolved], []]);

    await expect(
      resolveOwnedChangeReview(
        connection(query),
        'member-id',
        'change-id',
        'expected',
        resolved.reviewedAt,
      ),
    ).resolves.toMatchObject({ reviewedAt: resolved.reviewedAt, state: 'expected' });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("changes.state = 'pending'"), [
      'expected',
      resolved.reviewedAt,
      'change-id',
      'member-id',
    ]);
  });

  it('does not overwrite an already reviewed change', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockResolvedValueOnce([[review], []]);

    await expect(
      resolveOwnedChangeReview(connection(query), 'member-id', 'change-id', 'ignored'),
    ).rejects.toBeInstanceOf(ChangeReviewConflictError);
  });
});
