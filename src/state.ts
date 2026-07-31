import type { MatrixClient, RoomMember, MatrixEvent } from 'matrix-js-sdk';

export interface MemberRange {
  start: number;
  end: number;
}

export interface AppState {
  client: MatrixClient | null;
  roomId: string | null;
  spaceId: string | null;
  homeView: 'dms' | 'rooms';
  profileMember: RoomMember | null;
  loadingHistory: boolean;
  canLoadMore: boolean;
  allMembers: RoomMember[];
  memberRange: MemberRange;
  lastRoomPerSpace: Record<string, string>;
  replyTo: MatrixEvent | null;
  editingEvent: MatrixEvent | null;
}

const state: AppState = {
  client: null,
  roomId: null,
  spaceId: null,
  homeView: 'dms',
  profileMember: null,
  loadingHistory: false,
  canLoadMore: true,
  allMembers: [],
  memberRange: { start: 0, end: 40 },
  lastRoomPerSpace: {},
  replyTo: null,
  editingEvent: null,
};

export default state;
