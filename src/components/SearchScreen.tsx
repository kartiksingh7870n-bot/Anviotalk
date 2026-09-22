import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Search, Loader2, MapPin, X, Sparkles, AlertCircle, ChevronDown } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { 
  collection, 
  query, 
  getDocs, 
  limit, 
  where, 
  startAfter, 
  QueryDocumentSnapshot, 
  DocumentData,
  orderBy
} from "firebase/firestore";
import { db } from "../firebase";
import { getUserAvatar } from "../utils/avatar";
import AdPlacement from "./AdPlacement";
import { SearchResultSkeleton } from "./Skeletons";

const PAGE_SIZE = 15;

interface SearchScreenProps {
  onSelectCreator: (creator: any) => void;
}

// Helper to map Firestore document snapshot to clean Creator object
function mapDocToCreator(docSnap: QueryDocumentSnapshot<DocumentData> | DocumentData, id?: string) {
  const p = typeof docSnap.data === 'function' ? docSnap.data() : docSnap;
  const docId = id || (typeof docSnap.id === 'string' ? docSnap.id : p.uid || p.id || "user");
  
  return {
    id: p.uid || docId,
    name: p.displayName || p.fullName || p.name || "Aura Member",
    specialty: p.specialty || "Digital Creator",
    distance: p.distance || "0.5km",
    avatar: getUserAvatar(p),
    activeProject: p.bio || p.activeProject || "Creative mind.",
    x: p.x || 50,
    y: p.y || 50,
    status: p.status || "active",
    skillTags: Array.isArray(p.skillTags) ? p.skillTags : [],
    portfolioPhotos: Array.isArray(p.portfolioPhotos) ? p.portfolioPhotos : [],
    username: p.username || "creator",
    city: p.city || "",
    state: p.state || "",
    country: p.country || "",
    isVerified: Boolean(p.isVerified),
    accountStatus: p.accountStatus || 'active',
    createdAt: p.createdAt || null
  };
}

export default function SearchScreen({ onSelectCreator }: SearchScreenProps) {
  const { isFirebase } = useAuth();
  
  // Search input state
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  
  // Results & Pagination state
  const [results, setResults] = useState<any[]>([]);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  
  // Loading states
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 1. 500ms Debounce implementation
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchTerm]);

  const isDebouncing = searchTerm.trim() !== debouncedSearchTerm;

  // 2. Server-side Query Function with limit(15) and startAfter pagination
  const executeServerSearch = useCallback(async (term: string, cursorDoc: QueryDocumentSnapshot<DocumentData> | null = null, isAppend = false) => {
    try {
      setSearchError(null);
      if (!isAppend) {
        setIsInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const usersRef = collection(db, "users");
      const normalizedTerm = term.toLowerCase().trim();

      let fetchedDocs: QueryDocumentSnapshot<DocumentData>[] = [];
      let newLastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

      if (!normalizedTerm) {
        // Default browse view: Fetch first batch of users directly from server
        let defaultQuery = query(usersRef, limit(PAGE_SIZE));
        if (cursorDoc) {
          defaultQuery = query(usersRef, startAfter(cursorDoc), limit(PAGE_SIZE));
        }

        const snapshot = await getDocs(defaultQuery);
        fetchedDocs = snapshot.docs;
        newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      } else {
        // Server-side targeted search matching:
        // 1) searchKeywords array contains term (if indexed)
        // 2) username prefix query
        // 3) displayName prefix query
        // 4) city prefix query
        
        // We run targeted server queries bounded by limit(15)
        const queriesToRun = [];

        // Query 1: searchKeywords array (best for multi-keyword tag/name matches)
        queriesToRun.push(
          cursorDoc 
            ? query(usersRef, where("searchKeywords", "array-contains", normalizedTerm), startAfter(cursorDoc), limit(PAGE_SIZE))
            : query(usersRef, where("searchKeywords", "array-contains", normalizedTerm), limit(PAGE_SIZE))
        );

        // Query 2: username prefix
        queriesToRun.push(
          cursorDoc 
            ? query(usersRef, where("username", ">=", normalizedTerm), where("username", "<=", normalizedTerm + "\uf8ff"), startAfter(cursorDoc), limit(PAGE_SIZE))
            : query(usersRef, where("username", ">=", normalizedTerm), where("username", "<=", normalizedTerm + "\uf8ff"), limit(PAGE_SIZE))
        );

        // Query 3: displayName prefix (capitalized & lowercase)
        const capitalizedTerm = term.charAt(0).toUpperCase() + term.slice(1);
        queriesToRun.push(
          cursorDoc
            ? query(usersRef, where("displayName", ">=", capitalizedTerm), where("displayName", "<=", capitalizedTerm + "\uf8ff"), startAfter(cursorDoc), limit(PAGE_SIZE))
            : query(usersRef, where("displayName", ">=", capitalizedTerm), where("displayName", "<=", capitalizedTerm + "\uf8ff"), limit(PAGE_SIZE))
        );

        // Execute queries in parallel and merge unique docs
        const queryResults = await Promise.allSettled(queriesToRun.map(q => getDocs(q)));
        const seenDocIds = new Set<string>();
        const combinedDocs: QueryDocumentSnapshot<DocumentData>[] = [];

        for (const res of queryResults) {
          if (res.status === 'fulfilled') {
            for (const docSnap of res.value.docs) {
              if (!seenDocIds.has(docSnap.id)) {
                seenDocIds.add(docSnap.id);
                combinedDocs.push(docSnap);
              }
            }
          }
        }

        fetchedDocs = combinedDocs.slice(0, PAGE_SIZE);
        newLastDoc = fetchedDocs.length > 0 ? fetchedDocs[fetchedDocs.length - 1] : null;
      }

      // Map document snapshots to Creator data and filter out suspended/banned users
      const mappedResults = fetchedDocs
        .map(docSnap => mapDocToCreator(docSnap))
        .filter(c => {
          const accStatus = (c.accountStatus || (c.status === 'suspended' || c.status === 'banned' ? c.status : 'active')).toLowerCase();
          return accStatus !== 'suspended' && accStatus !== 'banned';
        });

      if (isAppend) {
        setResults(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNew = mappedResults.filter(p => !existingIds.has(p.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setResults(mappedResults);
      }

      setLastVisibleDoc(newLastDoc);
      setHasMore(fetchedDocs.length >= PAGE_SIZE);

    } catch (err: any) {
      console.error("Firestore search execution error:", err);
      setSearchError(err?.message || "Failed to load search results.");
      if (!isAppend) {
        setResults([]);
      }
    } finally {
      setIsInitialLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // 3. Trigger initial or debounced search query
  useEffect(() => {
    executeServerSearch(debouncedSearchTerm, null, false);
  }, [debouncedSearchTerm, executeServerSearch, isFirebase]);

  // 4. Handle "Load More" Pagination
  const handleLoadMore = () => {
    if (!isLoadingMore && hasMore && lastVisibleDoc) {
      executeServerSearch(debouncedSearchTerm, lastVisibleDoc, true);
    }
  };

  // Infinite scroll trigger via scroll container ref
  const containerRef = useRef<HTMLDivElement>(null);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - (scrollTop + clientHeight) < 120 && !isLoadingMore && hasMore && !isInitialLoading) {
      handleLoadMore();
    }
  };

  return (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-col w-full h-full bg-[#0A0A0A] text-white p-4 sm:p-6 overflow-y-auto"
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
    >
      {/* Header */}
      <div className="mb-6 text-left">
        <h2 className="text-2xl font-black tracking-tight text-white">Discover Creators</h2>
        <p className="text-xs text-[#B5B5B5] font-medium mt-0.5">
          Live server-side search across usernames, specialties, tags, and locations
        </p>
      </div>

      {/* Search Input Box */}
      <div className="relative mb-6">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#B5B5B5]">
          {isInitialLoading || isDebouncing ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#D7FF3F]" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </span>
        <input
          type="text"
          id="creator-search-input"
          name="creator-search-input"
          autoComplete="off"
          autoCorrect="off"
          data-lpignore="true"
          aria-autocomplete="none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Type name, username (@), specialty, or city..."
          className="w-full h-12 bg-[#141414] border border-[#2C3222] text-white rounded-2xl pl-11 pr-10 font-sans text-xs font-semibold focus:ring-1 focus:ring-[#D7FF3F] outline-none transition-all placeholder-[#707070] shadow-xs"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              setDebouncedSearchTerm("");
            }}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#707070] hover:text-white cursor-pointer focus:outline-none p-1"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results Header with Debounce & Loading info */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-[#B5B5B5] flex items-center gap-1.5">
          {debouncedSearchTerm ? (
            <>Search Results ({results.length}{hasMore ? "+" : ""})</>
          ) : (
            <>
              <Sparkles className="w-3 h-3 text-[#D7FF3F]" />
              Recommended Creators ({results.length})
            </>
          )}
        </h3>

        {/* Small Debounce indicator badge */}
        {isDebouncing && (
          <span className="text-[10px] text-[#D7FF3F] bg-[#1A1F12] border border-[#2C3222] px-2 py-0.5 rounded-full animate-pulse font-bold">
            Typing...
          </span>
        )}
      </div>

      {/* Error state if query fails */}
      {searchError && (
        <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-left flex items-center gap-2.5 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{searchError}</span>
        </div>
      )}

      {/* Results Area */}
      {isInitialLoading ? (
        <div className="space-y-3 py-2">
          <SearchResultSkeleton />
          <SearchResultSkeleton />
          <SearchResultSkeleton />
          <SearchResultSkeleton />
          <SearchResultSkeleton />
        </div>
      ) : results.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-[#1A1F12] flex items-center justify-center text-[#B5B5B5] mb-4 border border-dashed border-[#2C3222]">
            <Search className="w-6 h-6 text-[#D7FF3F]" />
          </div>
          <p className="font-extrabold text-white text-sm">
            {debouncedSearchTerm 
              ? `No creators found matching "${debouncedSearchTerm}"`
              : "No creator profiles found."}
          </p>
          <p className="text-xs text-[#B5B5B5] mt-1 max-w-[240px] mx-auto">
            Try searching for other keywords like "Architect", "Design", "Austin", or "Alex".
          </p>
        </div>
      ) : (
        <div className="space-y-3.5 pb-6">
          {results.map((creator, idx) => (
            <React.Fragment key={creator.id}>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => onSelectCreator(creator)}
                className="p-4 bg-[#1A1F12] border border-[#2C3222] hover:border-[#6E8A2B] rounded-[2rem] text-left flex gap-4 cursor-pointer active:scale-[0.99] transition-all shadow-xs"
              >
                <img
                  src={getUserAvatar(creator)}
                  alt={creator.name}
                  className="w-16 h-16 rounded-[1.25rem] object-cover border border-[#2C3222] shrink-0 bg-[#141414]"
                />
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-1">
                      <h4 className="font-black text-sm text-white tracking-tight truncate flex items-center gap-1">
                        <span>{creator.name}</span>
                      </h4>
                      <span className="text-[10px] text-[#B5B5B5] font-extrabold shrink-0">
                        @{creator.username}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10.5px] text-[#D7FF3F] font-black uppercase tracking-wider">
                        {creator.specialty}
                      </span>
                      {(creator.city || creator.country) && (
                        <span className="text-[10px] text-[#B5B5B5] font-medium flex items-center gap-0.5">
                          • <MapPin className="w-2.5 h-2.5 inline text-[#707070]" /> {creator.city || creator.country}
                        </span>
                      )}
                    </div>

                    <p className="text-[11.5px] text-[#B5B5B5] font-medium mt-1.5 line-clamp-2 leading-relaxed">
                      {creator.activeProject}
                    </p>
                  </div>

                  {/* Skill Tags */}
                  {creator.skillTags && creator.skillTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {creator.skillTags.slice(0, 3).map((tag: string, index: number) => (
                        <span
                          key={index}
                          className="text-[9px] font-bold text-[#D7FF3F] bg-[#141414] border border-[#2C3222] px-2 py-0.5 rounded-full"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Interspersed Home-Style Adsterra Inline Card */}
              {(idx + 1) % 3 === 0 && (
                <AdPlacement placement="discover_swipe" format="inline-card" adIndex={idx} />
              )}
            </React.Fragment>
          ))}

          {/* 5. Pagination / Load More Controls */}
          {hasMore && (
            <div className="pt-3 pb-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="h-10 px-6 bg-[#141414] hover:bg-[#1A1F12] border border-[#2C3222] hover:border-[#6E8A2B] text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D7FF3F]" />
                    <span>Loading more creators...</span>
                  </>
                ) : (
                  <>
                    <span>Load More Results</span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#D7FF3F]" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
