
# Installation of required packages
# Note: For other environment settings other than Jupyter Notebook or Google colab, please install the packages via terminal/command prompt without the '!' prefix.
# !pip install ddgs
# !pip install rank_bm25
# !pip install sentence_transformers

from ddgs import DDGS
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer, CrossEncoder
import numpy as np
from urllib.parse import urlparse
import json
import re
import requests
import os
import time
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from uuid import uuid4
from datetime import datetime
try:
    import faiss
except:
    faiss = None
TRUSTED_DOMAINS = set([
    'nytimes.com','bbc.co.uk','bbc.com','theguardian.com','reuters.com','apnews.com',
    'washingtonpost.com','wsj.com','cnn.com','aljazeera.com','sciencedaily.com',
    'nature.com','who.int','cdc.gov','gov.uk','un.org','nih.gov','statista.com','inquirer.net','philstar.com','manilatimes.net','mb.com.ph','manilastandard.net',
    'businessmirror.com.ph','gmanetwork.com','abs-cbn.com','news.abs-cbn.com','cnnphilippines.com','rappler.com',
    'sunstar.com.ph','pna.gov.ph','doh.gov.ph','psa.gov.ph','gov.ph'
])
def normalize_domain(url: str) -> str:
    try:
        n = urlparse(url or "").netloc.lower()
        if "@" in n:
            n = n.split("@")[-1]
        if n.startswith("www."):
            n = n[4:]
        if ":" in n:
            n = n.split(":")[0]
        return n
    except:
        return ""

def preprocess_and_expand_claim(text: str):
    """Return a dict with cleaned text, extracted date/entities and a ranked list of queries.

    This uses lightweight regex heuristics (no heavy NER) to remove noisy tokens
    from OCR/photo captions and produces multiple query variants.
    """
    import unicodedata
    orig = text or ""
    s = unicodedata.normalize("NFKC", orig)
    s = re.sub(r"Photo:\s*", "", s, flags=re.I)
    s = re.sub(r"\{.*?\}", " ", s)
    s = re.sub(r"\|.*$", " ", s)
    s = re.sub(r"[^\w\s\-\'\"]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    date = None
    m = re.search(r"(\b\d{4}-\d{2}-\d{2}\b)", orig)
    if not m:
        m = re.search(r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?", orig, flags=re.I)
    if m:
        date = m.group(0)

    acr = re.findall(r"\b[A-Z]{2,}\b", orig)
    acronyms = list(dict.fromkeys(acr))

    stop = set(["the","and","for","with","that","this","are","was","is","of","a","an","in","on","to","by"])
    toks = [w for w in re.findall(r"\w+", s) if len(w) > 2 and w.lower() not in stop]

    queries = []
    if acronyms:
        q_primary = " ".join(acronyms + toks[:8])
    else:
        q_primary = " ".join(toks[:10])
    if date:
        q_primary = f"{q_primary} {date}"
    queries.append(q_primary.strip())
    if acronyms:
        for a in acronyms:
            queries.append(f"{a} {toks[0:6] and ' '.join(toks[:6])}")

    head = " ".join(toks[:8])
    if head:
        queries.append(head)
    queries.append(head + " site:rappler.com")
    queries.append(head + " site:inquirer.net")

    syns = []
    if any(x.lower() in ["taxi","cab"] for x in toks):
        syns.append(re.sub(r"\btaxi\b","cab", q_primary, flags=re.I))
        syns.append(re.sub(r"\bcab\b","taxi", q_primary, flags=re.I))
    queries.extend([q for q in syns if q])

    seen = set(); qlist = []
    for q in queries:
        if not q: continue
        qq = q.strip()
        if qq not in seen:
            seen.add(qq); qlist.append(qq)

    return {"clean": s, "date": date, "entities": acronyms, "queries": qlist, "orig": orig}

def generate_claim_id(provided_id=None) -> str:
    if provided_id:
        return provided_id
    return f"CLM-{datetime.utcnow().strftime('%Y%m%d')}-{uuid4().hex[:8]}"
def ddg_search(query, k=50):
    results = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=k):
            title = r.get("title","")
            snippet = r.get("body","") or r.get("snippet","")
            href = r.get("href","")
            if not title and not snippet:
                continue
            text = f"{title}. {snippet}".strip()
            results.append({"text": text, "url": href})
    return results
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ResourceRetriever/1.0)"}
def fetch_page(url, timeout=8):
    """Return page text, title, publication_date and author when available."""
    if not url:
        return {"text": None, "title": None, "publication_date": None, "author": None}
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        if r.status_code != 200 or "text" not in (r.headers.get("content-type","")):
            return {"text": None, "title": None, "publication_date": None, "author": None}
        soup = BeautifulSoup(r.text, "html.parser")
        title = soup.title.string.strip() if soup.title and soup.title.string else None
        paragraphs = soup.find_all("p")
        text = "\n\n".join([p.get_text(" ", strip=True) for p in paragraphs if p.get_text(strip=True)])
        if not text:
            article = soup.find("article")
            if article:
                text = article.get_text(" ", strip=True)
        date = None
        for sel in [
            ('meta', {'property': 'article:published_time'}),
            ('meta', {'name': 'pubdate'}),
            ('meta', {'name': 'publication_date'}),
            ('meta', {'name': 'date'}),
            ('meta', {'property': 'og:updated_time'}),
            ('time', {})
        ]:
            try:
                tag = soup.find(sel[0], sel[1]) if sel[1] else soup.find(sel[0])
            except:
                tag = None
            if tag:
                if tag.name == "time":
                    txt = tag.get("datetime") or tag.get_text(" ", strip=True)
                else:
                    txt = tag.get("content") or tag.get("datetime") or tag.get_text(" ", strip=True)
                if txt:
                    date = txt
                    break
        pub_date = None
        if date:
            try:
                from dateutil import parser as dateparser
                parsed = dateparser.parse(date)
                pub_date = parsed.date().isoformat()
            except:
                m = re.search(r"(\d{4}-\d{2}-\d{2})", str(date))
                pub_date = m.group(1) if m else None
        author = None
        for sel in [{'name': 'author'}, {'property': 'article:author'}, {'name': 'byl'}, {'name': 'dc.creator'}]:
            try:
                tag = soup.find("meta", sel)
            except:
                tag = None
            if tag and tag.get("content"):
                author = tag.get("content"); break
        if not author:
            a_tag = soup.find("a", {"rel": "author"})
            if a_tag:
                author = a_tag.get_text(strip=True)
        return {"text": text or None, "title": title, "publication_date": pub_date, "author": author}
    except Exception:
        return {"text": None, "title": None, "publication_date": None, "author": None}

SENS_PATTERNS = [
    r"shocking", r"you won't believe", r"unbeliev", r"exposed", r"outrage", r"breakthrough",
    r"guarantee", r"miracle", r"worst", r"best ever", r"claim(s)? that", r"you won't"
]
OPINION_PATTERNS = [
    r"\bi think\b", r"\bin my opinion\b", r"\bwe believe\b", r"\bit seems\b", r"\bapparently\b",
    r"\bshould\b", r"\bmust\b", r"\bthat's why\b", r"\bimo\b"
]
SUBJECTIVE_LEXICON = set([
    "alleged","claim","claims","apparently","reportedly","rumor","rumour","opinion","suggest",
    "possibly","likely","unlikely","purported","allegedly","appears","seems","argue","argues"
])
def compute_writing_style(text: str):
    if not text:
        return {
            "sensational_language": False,
            "opinion_markers": False,
            "exclamation_ratio": 0.0,
            "uppercase_ratio": 0.0,
            "subjective_score": 0.0,
            "word_count": 0
        }
    s_plain = re.sub(r"\s+", " ", text.strip())
    words = s_plain.split()
    word_count = len(words)
    low = s_plain.lower()
    sensational = any(re.search(pat, low) for pat in SENS_PATTERNS)
    opinion = any(re.search(pat, low) for pat in OPINION_PATTERNS)
    exclaim_count = s_plain.count("!")
    exclamation_ratio = exclaim_count / max(1, word_count)
    uppercase_words = sum(1 for w in words if w.isupper() and len(w) > 1)
    uppercase_ratio = uppercase_words / max(1, word_count)
    subj_count = sum(1 for w in words if w.lower().strip(".,;:()\"'") in SUBJECTIVE_LEXICON)
    subjective_score = subj_count / max(1, word_count)
    sensational_final = sensational or (exclamation_ratio > 0.02) or (uppercase_ratio > 0.05)
    opinion_final = opinion or (subjective_score > 0.01)
    return {
        "sensational_language": bool(sensational_final),
        "opinion_markers": bool(opinion_final),
        "exclamation_ratio": round(exclamation_ratio, 4),
        "uppercase_ratio": round(uppercase_ratio, 4),
        "subjective_score": round(subjective_score, 4),
        "word_count": word_count
    }

class ResourceModel:
    def __init__(self, bm25_tokenizer=None, sbert_model_name="all-MiniLM-L6-v2", cross_encoder_name="cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.bm25_tokenizer = bm25_tokenizer or (lambda s: re.findall(r"\w+", s.lower()))
        self.sbert = SentenceTransformer(sbert_model_name)
        self.cross = CrossEncoder(cross_encoder_name)
        self.bm25 = None
        self.docs_text = []
        self.docs_url = []
        self.embeddings = None
        self.faiss_index = None

    def fit(self, documents):
        texts = [d.get("text","") for d in documents]
        urls = [d.get("url","") for d in documents]
        self.docs_text = texts
        self.docs_url = urls
        tokenized = [self.bm25_tokenizer(t) for t in texts]
        self.bm25 = BM25Okapi(tokenized)
        self.embeddings = self.sbert.encode(texts, convert_to_numpy=True, show_progress_bar=False)
        if faiss is not None and getattr(self.embeddings, "size", 0):
            faiss.normalize_L2(self.embeddings)
            d = self.embeddings.shape[1]
            self.faiss_index = faiss.IndexFlatIP(d)
            self.faiss_index.add(self.embeddings)

    def retrieve_bm25(self, query, k=10):
        toks = self.bm25_tokenizer(query)
        scores = self.bm25.get_scores(toks)
        idx = np.argsort(scores)[::-1][:k]
        return [{"id": int(i), "url": self.docs_url[int(i)], "text": self.docs_text[int(i)], "score": float(scores[int(i)]), "orig_source": "bm25", "orig_score": float(scores[int(i)])} for i in idx]

    def retrieve_dense(self, query, k=10):
        qv = self.sbert.encode([query], convert_to_numpy=True)[0]
        if faiss is not None and self.faiss_index is not None:
            faiss.normalize_L2(qv.reshape(1, -1))
            scores, idx = self.faiss_index.search(qv.reshape(1, -1), k)
            idx = idx[0]; scores = scores[0]
            return [{"id": int(i), "url": self.docs_url[int(i)], "text": self.docs_text[int(i)], "score": float(scores[j]), "orig_source": "dense", "orig_score": float(scores[j])} for j,i in enumerate(idx)]
        emb = self.embeddings
        qv = qv / np.linalg.norm(qv)
        emb_norm = emb / np.linalg.norm(emb, axis=1, keepdims=True)
        sims = emb_norm @ qv
        idx = np.argsort(sims)[::-1][:k]
        return [{"id": int(i), "url": self.docs_url[int(i)], "text": self.docs_text[int(i)], "score": float(sims[int(i)]), "orig_source": "dense", "orig_score": float(sims[int(i)])} for i in idx]

    def rerank(self, query, candidates, k=10):
        pairs = [(query, c["text"]) for c in candidates]
        scores = self.cross.predict(pairs)
        order = np.argsort(scores)[::-1][:k]
        return [{"id": int(candidates[i]["id"]), "url": candidates[i]["url"], "text": candidates[i]["text"], "score": float(scores[i]), "orig_source": candidates[i].get("orig_source"), "orig_score": candidates[i].get("orig_score")} for i in order]

    def search(self, query, k=5, bm25_k=50, dense_k=50):
        b = self.retrieve_bm25(query, bm25_k)
        d = self.retrieve_dense(query, dense_k)
        seen = set(); merged = []
        for item in b + d:
            if item["id"] not in seen:
                merged.append(item); seen.add(item["id"])
        return self.rerank(query, merged, k)

try:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import torch
    _mnli_tokenizer = AutoTokenizer.from_pretrained("roberta-large-mnli")
    _mnli_model = AutoModelForSequenceClassification.from_pretrained("roberta-large-mnli")
    _mnli_model.eval()
    _mnli_device = "cuda" if torch.cuda.is_available() else "cpu"
    _mnli_model.to(_mnli_device)
    def detect_polarity(claim_text, doc_text):
        try:
            enc = _mnli_tokenizer(claim_text, doc_text, truncation=True, padding=True, return_tensors="pt").to(_mnli_device)
            with torch.no_grad():
                out = _mnli_model(**enc)
                logits = out.logits.cpu().numpy()[0]
            lab = int(logits.argmax())
            if lab == 2: return 1
            if lab == 0: return -1
            return 0
        except:
            return 0
except Exception:
    SUPPORT_KW = ["confirm", "confirmed", "true", "supports", "agrees", "said", "reported"]
    REFUTE_KW = ["no", "false", "denies", "disagrees", "not true", "misleading", "debunk"]
    def detect_polarity(claim_text, doc_text):
        t = (doc_text or "").lower()
        s = sum(1 for kw in SUPPORT_KW if kw in t)
        r = sum(1 for kw in REFUTE_KW if kw in t)
        if s > r: return 1
        if r > s: return -1
        return 0

def compute_cred_score(domain: str):
    if not domain: return 0.6
    d = domain.lower()
    if d in TRUSTED_DOMAINS: return 0.98
    if d.endswith(".gov") or d.endswith(".edu"): return 0.95
    if d.endswith(".org"): return 0.85
    return 0.60


if __name__ == "__main__":
    provided_claim_id = None
    claim_id = generate_claim_id(provided_claim_id)
    claim_text = "The way Chaewon went viral for wearing their tote bag merch as a top is so iconic." # Claim changeuuuuuu


    expanded = preprocess_and_expand_claim(claim_text)
    queries = expanded.get("queries") or [claim_text]

    MEDIASTACK_API_KEY = os.environ.get("439f2eb0496df5a39926d771e9eb9a13")
    NEWSAPI_ORG_KEY = os.environ.get("cab15a813be74fbb9463147859b493c9")

    def search_mediastack(query, api_key, limit=25):
        if not api_key:
            return []
        url = "http://api.mediastack.com/v1/news"
        params = {"access_key": api_key, "keywords": query, "limit": limit}
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=8)
            if r.status_code != 200:
                return []
            data = r.json()
            items = data.get("data") or []
            out = []
            for it in items:
                title = it.get("title") or ""
                desc = it.get("description") or ""
                link = it.get("url") or it.get("link") or ""
                text = (title + ". " + desc).strip()
                if text:
                    out.append({"text": text, "url": link})
            return out
        except Exception:
            return []

    def search_newsapi_org(query, api_key, limit=50):
        """Search NewsAPI.org (local PH news focus)."""
        if not api_key:
            return []
        url = "https://newsapi.org/v2/everything"
        params = {
            "q": query,
            "apiKey": api_key,
            "pageSize": limit,
            "sortBy": "relevancy",
            "language": "en"
        }
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=8)
            if r.status_code != 200:
                return []
            data = r.json()
            articles = data.get("articles") or []
            out = []
            for art in articles:
                title = art.get("title") or ""
                desc = art.get("description") or ""
                link = art.get("url") or ""
                text = (title + ". " + desc).strip()
                if text:
                    out.append({"text": text, "url": link})
            return out
        except Exception:
            return []

    pool_docs = []
    seen = set()
    trusted_count = 0
    for q in queries:
        try:
            ddg_res = ddg_search(q, k=80)
        except Exception:
            ddg_res = []
        for d in ddg_res:
            u = (d.get("url") or "").strip()
            if u and u in seen:
                continue
            seen.add(u)
            if d.get("text", "").strip():
                pool_docs.append(d)
                if normalize_domain(u) in TRUSTED_DOMAINS:
                    trusted_count += 1
        if MEDIASTACK_API_KEY:
            try:
                ms = search_mediastack(q, MEDIASTACK_API_KEY, limit=50)
            except Exception:
                ms = []
            for d in ms:
                u = (d.get("url") or "").strip()
                if u and u in seen:
                    continue
                seen.add(u)
                pool_docs.append(d)
                if normalize_domain(u) in TRUSTED_DOMAINS:
                    trusted_count += 1
        if NEWSAPI_ORG_KEY:
            try:
                na = search_newsapi_org(q, NEWSAPI_ORG_KEY, limit=50)
            except Exception:
                na = []
            for d in na:
                u = (d.get("url") or "").strip()
                if u and u in seen:
                    continue
                seen.add(u)
                pool_docs.append(d)
                if normalize_domain(u) in TRUSTED_DOMAINS:
                    trusted_count += 1
        if trusted_count >= 3:
            break

    pool_docs = [d for d in pool_docs if d.get("url","").strip() and normalize_domain(d.get("url",""))]

    if not pool_docs:
        pool_docs = [{"text": claim_text, "url": ""}]

    def fetch_pool_full_texts(docs, max_fetch=80):
        urls = [d.get("url") for d in docs if d.get("url")]
        urls = list(dict.fromkeys(urls))[:max_fetch]
        fetched = {}
        if not urls:
            return docs
        with ThreadPoolExecutor(max_workers=6) as ex:
            futures = {ex.submit(fetch_page, u): u for u in urls}
            for fut in as_completed(futures):
                u = futures[fut]
                try:
                    fetched[u] = fut.result()
                except:
                    fetched[u] = {"text": None}
        out = []
        for d in docs:
            u = d.get("url")
            if u and u in fetched and fetched[u].get("text"):
                nt = fetched[u].get("text")
                out.append({"text": nt, "url": u})
            else:
                out.append(d)
        return out

    pool_docs = fetch_pool_full_texts(pool_docs, max_fetch=80)

    model = ResourceModel()
    model.fit(pool_docs)

    reranked = model.search(claim_text, k=200, bm25_k=500, dense_k=500)
    raw_scores = [float(r.get("score", 0.0)) for r in reranked]
    if not raw_scores:
        min_s, max_s = 0.0, 1.0
    elif len(raw_scores) == 1:
        min_s = max_s = raw_scores[0]
    else:
        min_s, max_s = min(raw_scores), max(raw_scores)
    span = max_s - min_s if abs(max_s - min_s) > 1e-8 else None

    def norm_score(s):
        if span is None:
            return 1.0
        return max(0.0, min(1.0, (float(s) - min_s) / span))


    for r in reranked:
        r['_relevance_norm'] = norm_score(r.get("score", 0.0))
        r['_cred'] = compute_cred_score(normalize_domain(r.get("url", "")) or "")
        r['_weighted'] = r['_relevance_norm'] * r['_cred']

    all_results = sorted(reranked, key=lambda r: (r.get('_relevance_norm', 0.0), r.get('_cred', 0.0)), reverse=True)
    evidences = []
    for idx, r in enumerate(all_results, start=1):
        raw_score = float(r.get("score", 0.0))
        relevance_norm = float(r.get('_relevance_norm', 0.0))
        url = r.get("url", "") or ""
        domain = normalize_domain(url) or None
        cred = compute_cred_score(domain or "")
        snippet = (r.get("text", "") or "")[:1000]
        meta = {
            "source_type": "fact-checking organization" if any(k in (url.lower() + " " + snippet.lower()) for k in ["fact-check","politifact","snopes","factcheck"]) else ("web" if domain else "local_corpus"),
            "author": None,
            "publication_history": "reputable" if cred >= 0.9 else "mixed" if cred >= 0.6 else "flagged",
            "writing_style_features": compute_writing_style(snippet)
        }
        evidences.append({
            "evidence_id": f"EV-{idx:03d}",
            "evidence_snippet": snippet,
            "url": url or None,
            "domain": domain,
            "publication_date": None,
            "raw_relevance_score": raw_score,
            "relevance_score": round(relevance_norm, 4),
            "credibility_score": round(cred, 2),
            "polarity": 0,
            "metadata": meta
        })
    TOP_K_SCRAPE = min(12, len(evidences))
    urls_to_scrape = [e["url"] for e in evidences[:TOP_K_SCRAPE] if e.get("url")]
    fetched = {}
    if urls_to_scrape:
        with ThreadPoolExecutor(max_workers=6) as ex:
            futures = {ex.submit(fetch_page, url): url for url in urls_to_scrape}
            for fut in as_completed(futures):
                u = futures[fut]
                try:
                    fetched[u] = fut.result()
                except:
                    fetched[u] = {"text": None, "title": None, "publication_date": None, "author": None}

    for e in evidences:
        u = e.get("url")
        if u and u in fetched and fetched[u].get("text"):
            page = fetched[u]
            text = page.get("text") or ""
            e["evidence_snippet"] = text[:1000]
            e["publication_date"] = page.get("publication_date")
            e["metadata"]["author"] = page.get("author")
            e["metadata"]["writing_style_features"] = compute_writing_style(text)
        e["polarity"] = int(detect_polarity(claim_text, e.get("evidence_snippet","") or ""))

    out = {
        "claim_id": claim_id,
        "claim_text": claim_text,
        "retrieved_evidences": evidences
    }

    with open("results.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))