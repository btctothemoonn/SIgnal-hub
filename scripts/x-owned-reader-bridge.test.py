"""Offline contract tests. Linux additionally exercises real HTTPx over loopback."""
import asyncio
from contextlib import closing
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent

def load_core():
    path = ROOT / 'x-owned-reader-bridge-core.py'
    if not path.exists():
        raise AssertionError('Owned reader parsing and request guards are not implemented')
    spec = importlib.util.spec_from_file_location('owned_reader_core', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

def load_bridge():
    spec=importlib.util.spec_from_file_location('owned_reader_bridge',ROOT/'x-owned-reader-bridge.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def tweet(identifier='100', date='Sun Oct 04 00:00:00 +0000 2026', username='Alice', user_id='7', **extra):
    return {'__typename': 'Tweet', 'rest_id': identifier,
      'core': {'user_results': {'result': {'rest_id': user_id, 'core': {'screen_name': username, 'name': username}, 'avatar': {'image_url': 'https://pbs.twimg.com/a.jpg'}}}},
      'legacy': {'id_str': identifier, 'user_id_str': user_id, 'created_at': date, 'full_text': 'body '+identifier,
                 'favorite_count': 2, 'reply_count': 3, 'retweet_count': 4, 'quote_count': 5, 'entities': {'hashtags': []}, **extra}}

def item(result, pinned=False):
    content = {'itemType': 'TimelineTweet', 'tweetDisplayType': 'Tweet', 'tweet_results': {'result': result}}
    if pinned: content['socialContext'] = {'contextType': 'Pin', 'type': 'TimelineGeneralContext'}
    return {'entryId': 'tweet-'+result['rest_id'], 'content': {'entryType': 'TimelineTimelineItem', 'itemContent': content}}

def cursor(value='next'):
    return {'entryId': 'cursor-bottom-0', 'content': {'entryType': 'TimelineTimelineCursor', 'cursorType': 'Bottom', 'value': value}}

def page(entries, terminate=False):
    instructions = [{'type': 'TimelineAddEntries', 'entries': entries}]
    if terminate: instructions.append({'type': 'TimelineTerminateTimeline', 'direction': 'Bottom'})
    return {'data': {'user': {'result': {'timeline_v2': {'timeline': {'instructions': instructions}}}}}}

def conversation(results, focal=None):
    content = {'entryType': 'TimelineTimelineModule', 'displayType': 'VerticalConversation',
               'metadata': {'conversationMetadata': {'allTweetIds': [r['rest_id'] for r in results]}},
               'items': [{'entryId': 'profile-conversation-999-tweet-'+r['rest_id'], 'item': {'itemContent': {'itemType': 'TimelineTweet', 'tweetDisplayType': 'Tweet', 'tweet_results': {'result': r}}}} for r in results]}
    if focal: content['metadata']['conversationMetadata']['focalTweetId'] = focal
    return {'entryId': 'profile-conversation-999', 'content': content}

def detail(result, extras=None):
    return {'data': {'threaded_conversation_with_injections_v2': {'instructions': [{'type':'TimelineAddEntries','entries':[item(result),*(extras or [])]}]}}}

def visibility_item(result):
    entry=item(result); child=deepcopy(result); child.pop('__typename',None)
    entry['content']['itemContent']['tweet_results']['result']={'__typename':'TweetWithVisibilityResults','tweet':child}
    return entry

def subscriber_item(result):
    entry=item(result)
    entry['content']['itemContent']['tweet_results']['result']={
        '__typename':'TweetPreviewDisplay','tweet':{'rest_id':result['rest_id'],'core':deepcopy(result['core']),'created_at':result['legacy']['created_at'],'text':'partial subscriber body…'},
        'cta':{'title':'Subscribe to unlock','url':{'url':'https://x.com/'+result['core']['user_results']['result']['core']['screen_name']+'/superfollows/subscribe','urlType':'ExternalUrl'}}}
    return entry

def subscriber_detail(result):
    body=detail(result); body['data']['threaded_conversation_with_injections_v2']['instructions'][0]['entries'][0]=subscriber_item(result)
    return body

class Parsing(unittest.TestCase):
    def setUp(self): self.c = load_core()
    def parse(self, body): return self.c.parse_timeline_page(body, 'Alice', '7', '2026-10-03T00:00:00Z', '2026-10-04T01:00:00Z')
    def test_more_than_twenty_standalone_roots_are_not_truncated(self):
        parsed = self.parse(page([item(tweet(str(100+i))) for i in range(27)] + [cursor()]))
        self.assertEqual(len(parsed['tweets']), 27)
        self.assertEqual(parsed['tweets'][0]['evidence']['selection'], 'standalone')
        self.assertFalse(parsed['complete'])
    def test_nested_quote_is_context_and_complete_note_text_wins(self):
        original = tweet(); original['note_tweet'] = {'note_tweet_results': {'result': {'text': 'full long form body'}}}
        original['quoted_status_result'] = {'result': tweet('99', username='Other', user_id='8')}
        parsed = self.parse(page([item(original), cursor('')]))
        self.assertEqual([r['feedItem']['id'] for r in parsed['tweets']], ['100'])
        feed = parsed['tweets'][0]['feedItem']
        self.assertEqual(feed['text'], 'full long form body')
        self.assertEqual(feed['quotedTweet']['id'], '99')
        self.assertEqual(feed['quotedTweet']['contentSource'], 'owned-reader')
        self.assertTrue(feed['contentComplete'])
        self.assertEqual(feed['origin'], 'watch')
        self.assertTrue(parsed['complete'])
    def test_quote_revision_is_its_own_edit_proof(self):
        root=tweet(); root['edit_control']={'edit_tweet_ids':['98','100']}
        quoted=tweet('99',username='Other',user_id='8'); root['quoted_status_result']={'result':quoted}
        quote=self.parse(page([item(root),cursor('')]))['tweets'][0]['feedItem']['quotedTweet']
        self.assertNotIn('contentVersion',quote)
        quoted['edit_control']={'edit_tweet_ids':['97','99']}
        quote=self.parse(page([item(root),cursor('')]))['tweets'][0]['feedItem']['quotedTweet']
        self.assertEqual(quote['contentVersion'],'99'); self.assertTrue(quote['contentComplete'])
    def test_explicit_focal_selects_only_reply_and_keeps_parent_context(self):
        parent, reply = tweet('90'), tweet('100', in_reply_to_status_id_str='90', in_reply_to_screen_name='Alice')
        parsed = self.parse(page([conversation([parent, reply], '100'), cursor('')]))
        self.assertEqual([r['feedItem']['id'] for r in parsed['tweets']], ['100'])
        self.assertEqual(parsed['tweets'][0]['feedItem']['quotedTweet']['relation'], 'reply')
        self.assertEqual(parsed['tweets'][0]['feedItem']['quotedTweet']['id'], '90')
        self.assertEqual(parsed['tweets'][0]['evidence']['selection'], 'focal')
        self.assertEqual(parsed['tweets'][0]['feedItem']['eventType'],'NEW_TWEET_REPLY')
    def test_unknown_same_author_conversation_quarantines_even_with_termination(self):
        parsed = self.parse(page([conversation([tweet('90'), tweet('100')]), cursor('')]))
        self.assertEqual(parsed['tweets'], [])
        self.assertFalse(parsed['complete'])
        self.assertEqual(parsed['reason'], 'unknown_conversation_module')
    def test_explicit_focal_old_conversation_never_proves_profile_boundary(self):
        old=tweet('90','Thu Oct 01 00:00:00 +0000 2026')
        parsed=self.parse(page([conversation([old],'90'),cursor()]))
        self.assertEqual(parsed['quarantined'],0); self.assertFalse(parsed['boundary']); self.assertFalse(parsed['complete'])
    def test_old_pin_cannot_end_scan(self):
        parsed = self.parse(page([item(tweet('80', 'Thu Oct 01 00:00:00 +0000 2026'), pinned=True), item(tweet()), cursor()]))
        self.assertFalse(parsed['complete'])
        self.assertEqual([r['feedItem']['id'] for r in parsed['tweets']], ['100'])
    def test_non_pinned_old_root_proves_time_boundary(self):
        parsed = self.parse(page([item(tweet()), item(tweet('80', 'Thu Oct 01 00:00:00 +0000 2026')), cursor()]))
        self.assertTrue(parsed['complete'])
    def test_empty_without_explicit_termination_is_incomplete(self):
        self.assertFalse(self.parse(page([]))['complete'])
        self.assertTrue(self.parse(page([], terminate=True))['complete'])
        self.assertTrue(self.parse(page([cursor('')]))['complete'])
    def test_wrong_author_preview_retweet_and_missing_structure_do_not_complete(self):
        preview = {'__typename': 'TweetPreviewDisplay', 'rest_id': '101', 'tweet': tweet('101')}
        original = tweet(); original['legacy']['retweeted_status_result'] = {'result': tweet('99')}
        parsed = self.parse(page([item(tweet('102', user_id='9')), item(preview), item(original), cursor('')]))
        self.assertEqual(parsed['tweets'], [])
        self.assertFalse(parsed['complete'])
        self.assertGreater(parsed['quarantined'], 0)
        self.assertFalse(self.parse({'data': {}})['complete'])
    def test_truncated_body_and_unknown_note_structure_are_quarantined(self):
        result = tweet(truncated=True)
        self.assertFalse(self.parse(page([item(result), cursor('')]))['complete'])
        result = tweet(); result['note_tweet'] = {'note_tweet_results': {'result': None}}
        self.assertEqual(self.parse(page([item(result), cursor('')]))['tweets'], [])
    def test_media_and_edit_version_preserved_without_raw_response(self):
        result = tweet(); result['legacy']['extended_entities'] = {'media': [{'type': 'photo', 'media_url_https': 'https://pbs.twimg.com/photo.jpg', 'original_info': {'width': 800, 'height': 600}}]}
        result['edit_control'] = {'edit_tweet_ids': ['98', '100']}
        feed = self.parse(page([item(result), cursor('')]))['tweets'][0]['feedItem']
        self.assertEqual(feed['media'][0]['kind'], 'image')
        self.assertEqual(feed['media'][0]['width'], 800)
        self.assertEqual(feed['contentVersion'], '100')
        self.assertNotIn('raw', feed)
    def test_explicit_visibility_wrapper_with_untyped_full_child_is_supported(self):
        root=tweet(); quoted=tweet('99',username='Other',user_id='8')
        quoted.pop('__typename'); root['quoted_status_result']={'result':{'__typename':'TweetWithVisibilityResults','tweet':quoted}}
        parsed=self.parse(page([visibility_item(root),cursor('')]))
        self.assertTrue(parsed['complete']); self.assertEqual(parsed['quarantined'],0)
        self.assertEqual(parsed['tweets'][0]['feedItem']['text'],'body 100')
        self.assertEqual(parsed['tweets'][0]['feedItem']['quotedTweet']['text'],'body 99')
        canonical=detail(root)
        canonical['data']['threaded_conversation_with_injections_v2']['instructions'][0]['entries'][0]=visibility_item(root)
        self.assertEqual(self.c.canonical_tweet(canonical,'100')['text'],'body 100')
    def test_visibility_wrapper_does_not_promote_untyped_partial_or_unavailable_children(self):
        for change in ('untyped','missing_id','missing_author','missing_body','truncated','unavailable','preview'):
            with self.subTest(change=change):
                entry=visibility_item(tweet()); raw=entry['content']['itemContent']['tweet_results']['result']; child=raw['tweet']
                if change=='untyped': entry['content']['itemContent']['tweet_results']['result']=child
                elif change=='missing_id': child['legacy'].pop('id_str')
                elif change=='missing_author': child.pop('core')
                elif change=='missing_body': child['legacy'].pop('full_text')
                elif change=='truncated': child['legacy']['truncated']=True
                elif change=='unavailable': child['__typename']='TweetUnavailable'
                else: raw['__typename']='TweetPreviewDisplay'
                parsed=self.parse(page([entry,cursor('')]))
                self.assertFalse(parsed['complete']); self.assertEqual(parsed['tweets'],[])
    def test_untyped_old_visibility_pin_cannot_supply_time_boundary(self):
        entry=visibility_item(tweet('80','Thu Oct 01 00:00:00 +0000 2026'))
        entry['content']['itemContent']['socialContext']={'contextType':'Pin'}
        parsed=self.parse(page([entry,item(tweet()),cursor()]))
        self.assertEqual(parsed['quarantined'],0); self.assertFalse(parsed['boundary']); self.assertFalse(parsed['complete'])
    def test_complete_long_note_in_visibility_wrapper_overrides_truncated_legacy(self):
        root=tweet(truncated=True); root['note_tweet']={'note_tweet_results':{'result':{'text':'complete long note body'}}}
        expected=self.c.tweet_feed(root)
        parsed=self.parse(page([visibility_item(root),cursor('')]))
        self.assertTrue(parsed['complete']); self.assertEqual(parsed['tweets'][0]['feedItem']['text'],expected['text'])
        body=detail(root); body['data']['threaded_conversation_with_injections_v2']['instructions'][0]['entries'][0]=visibility_item(root)
        self.assertEqual(self.c.canonical_tweet(body,'100')['text'],'complete long note body')
    def test_visibility_wrapper_with_malformed_note_cannot_use_truncated_legacy(self):
        for note in (None,{}, {'note_tweet_results':{'result':None}}, {'note_tweet_results':{'result':{'text':None}}}):
            root=tweet(truncated=True); root['note_tweet']=note
            parsed=self.parse(page([visibility_item(root),cursor('')]))
            self.assertFalse(parsed['complete']); self.assertEqual(parsed['tweets'],[])

class Scanning(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self): self.c = load_core()
    async def test_five_pages_without_boundary_cannot_claim_coverage(self):
        seen = []
        async def fetch(cur):
            seen.append(cur)
            return page([item(tweet(str(100+len(seen)))), cursor('p'+str(len(seen)))])
        result = await self.c.scan_account(fetch, {'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'}, 5)
        self.assertEqual(len(seen), 5)
        self.assertEqual(result['accepted'], 5)
        self.assertFalse(result['complete'])
        self.assertEqual(result['reason'], 'page_limit_reached')
    async def test_valid_second_page_boundary_complete_and_deduplicated(self):
        bodies = [page([item(tweet()), cursor('p1')]), page([item(tweet()), item(tweet('80','Thu Oct 01 00:00:00 +0000 2026')), cursor('p2')])]
        async def fetch(cur): return bodies.pop(0)
        result = await self.c.scan_account(fetch, {'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'}, 5)
        self.assertTrue(result['complete'])
        self.assertEqual(result['accepted'], 1)
        self.assertEqual(result['pages'], 2)
    async def test_cursor_loop_stops_before_page_limit(self):
        async def fetch(cur): return page([item(tweet()), cursor('same')])
        result = await self.c.scan_account(fetch, {'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'}, 5)
        self.assertFalse(result['complete']); self.assertEqual(result['pages'], 2)
        self.assertEqual(result['reason'], 'cursor_stalled')
    async def test_posts_complete_with_independent_unknown_reply_coverage(self):
        queries=[]
        async def fetch(kind,cur):
            queries.append(kind)
            return page([item(tweet()),cursor('')]) if kind=='posts' else page([conversation([tweet('90'),tweet('100')]),cursor('')])
        result=await self.c.scan_coverage(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5)
        self.assertTrue(result['complete']); self.assertFalse(result['replyCoverageComplete'])
        self.assertEqual(result['coverageKind'],'posts-and-quotes'); self.assertEqual(result['replyReason'],'unknown_conversation_module')
        self.assertEqual(queries,['posts','replies'])
    async def test_posts_use_shared_five_page_budget_before_replies(self):
        queries=[]
        async def fetch(kind,cur):
            queries.append(kind)
            return page([item(tweet()),cursor('' if len(queries)==5 else str(len(queries)))])
        result=await self.c.scan_coverage(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5)
        self.assertTrue(result['complete']); self.assertFalse(result['replyCoverageComplete'])
        self.assertEqual(result['replyReason'],'reply_page_budget_unavailable')
        self.assertEqual(queries,['posts']*5); self.assertEqual(result['pages'],5)
    async def test_unknown_conversation_resolves_only_canonical_ids_with_original_dates(self):
        parent=tweet('90','Thu Oct 01 00:00:00 +0000 2026'); reply=tweet('100',in_reply_to_status_id_str='90')
        async def fetch(cur): return page([conversation([parent,reply]),cursor('')])
        requests=[]
        async def canonical(identifier):
            requests.append(identifier); return detail(parent if identifier=='90' else reply)
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5,fetch_detail=canonical)
        self.assertTrue(result['complete']); self.assertEqual(requests,['100'])
        self.assertEqual(result['accepted'],1); event=result['tweets'][0]
        self.assertEqual(event['feedItem']['createdAt'],'2026-10-04T00:00:00Z')
        self.assertEqual(event['evidence']['requestedTweetId'],'100')
        self.assertEqual(event['evidence']['requestKind'],'TweetDetail')
    async def test_canonical_skips_inline_proven_foreign_and_out_of_window_module_ids(self):
        old=tweet('90','Thu Oct 01 00:00:00 +0000 2026'); foreign=tweet('91',username='Other',user_id='8'); focal=tweet('100')
        async def fetch(cur): return page([conversation([old,foreign,focal]),cursor('')])
        requests=[]
        async def canonical(identifier): requests.append(identifier); return detail(focal)
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5,fetch_detail=canonical)
        self.assertTrue(result['complete']); self.assertEqual(requests,['100']); self.assertEqual(result['accepted'],1)
    def test_out_of_window_unknown_module_does_not_supply_boundary_evidence(self):
        old=tweet('90','Thu Oct 01 00:00:00 +0000 2026')
        parsed=self.c.parse_timeline_page(page([conversation([old]),cursor()]),'Alice','7','2026-10-03T00:00:00Z','2026-10-04T01:00:00Z')
        self.assertFalse(parsed['complete']); self.assertFalse(parsed['boundary']); self.assertEqual(parsed['tweets'],[])
        self.assertEqual(parsed['quarantined'],0)
    async def test_hidden_old_snowflake_parent_skips_detail_without_supplying_boundary(self):
        parent_id='2093021694671888665'; child=tweet('2093023742641549624','Thu Aug 27 17:12:01 +0000 2026',in_reply_to_status_id_str=parent_id)
        module=conversation([child]); module['content']['metadata']['conversationMetadata']['allTweetIds']=[parent_id,child['rest_id']]
        parsed=self.c.parse_timeline_page(page([module,cursor()]),'Alice','7','2026-10-03T00:00:00Z','2026-10-04T01:00:00Z')
        self.assertEqual(parsed['quarantined'],0); self.assertFalse(parsed['boundary']); self.assertFalse(parsed['complete'])
        async def fetch(cur): return page([module,cursor('')])
        requests=[]
        async def canonical(identifier): requests.append(identifier); return {'data':{}}
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},fetch_detail=canonical)
        self.assertTrue(result['complete']); self.assertEqual(result['accepted'],0); self.assertEqual(requests,[])
    def test_snowflake_exclusion_crosschecks_real_dates_and_rejects_non_snowflakes(self):
        known=[('2106416741035417965','2026-10-03T16:11:01Z'),('2105108121538703453','2026-09-30T01:31:01Z'),('2093023742641549624','2026-08-27T17:12:01Z')]
        for identifier,date in known:
            self.assertEqual(int(self.c.snowflake_timestamp(identifier)),int(self.c.instant(date)))
        lower=self.c.instant('2026-10-03T00:00:00Z'); upper=self.c.instant('2026-10-04T01:00:00Z')
        for identifier in ('100','0','0103021694671888665','9223372036854775808','9999999999999999999999999','not-an-id','2106416741035417965'):
            self.assertFalse(self.c.snowflake_outside_window(identifier,lower,upper),identifier)
        for when in (lower-60,lower,upper,upper+60):
            identifier=str((int(when*1000)-1288834974657)<<22)
            self.assertFalse(self.c.snowflake_outside_window(identifier,lower,upper),identifier)
        self.assertTrue(self.c.snowflake_outside_window('2093021694671888665',lower,upper))
    async def test_missing_small_or_window_parent_cannot_be_excluded_using_child_age(self):
        for parent_id in ('100','2106416741035417965'):
            module=conversation([tweet('2093023742641549624','Thu Aug 27 17:12:01 +0000 2026')]); module['content']['metadata']['conversationMetadata']['allTweetIds'].insert(0,parent_id)
            async def fetch(cur): return page([module,cursor('')])
            requests=[]
            async def canonical(identifier): requests.append(identifier); return {'data':{}}
            result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},fetch_detail=canonical)
            self.assertFalse(result['complete']); self.assertEqual(requests,[parent_id])
    async def test_hidden_edit_id_after_upper_still_requires_original_creation_confirmation(self):
        identifier='2106550367155126272'
        edited=tweet(identifier); edited['edit_control']={'edit_tweet_ids':['2106534768538419200',identifier]}
        module=conversation([]); module['content']['metadata']['conversationMetadata']['allTweetIds']=[identifier]
        parsed=self.c.parse_timeline_page(page([module,cursor('')]),'Alice','7','2026-10-03T00:00:00Z','2026-10-04T01:00:00Z')
        self.assertFalse(parsed['complete']); self.assertEqual(parsed['resolutions'][0]['identifiers'],[identifier])
        async def fetch(cur): return page([module,cursor('')])
        requests=[]
        async def canonical(requested): requests.append(requested); return detail(edited)
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},fetch_detail=canonical)
        self.assertTrue(result['complete']); self.assertEqual(requests,[identifier]); self.assertEqual(result['accepted'],1)
        self.assertEqual(result['tweets'][0]['feedItem']['createdAt'],'2026-10-04T00:00:00Z')
    async def test_canonical_subscriber_exclusion_records_ids_without_preview_feed(self):
        bodies=[page([subscriber_item(tweet()),cursor('p1')]),page([subscriber_item(tweet()),item(tweet('80','Thu Oct 01 00:00:00 +0000 2026')),cursor('p2')])]
        async def fetch(cur): return bodies.pop(0)
        requests=[]; emitted=[]
        async def canonical(identifier): requests.append(identifier); return subscriber_detail(tweet())
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},on_tweet=emitted.append,fetch_detail=canonical)
        self.assertTrue(result['complete']); self.assertEqual(result['quarantined'],0)
        self.assertEqual(result['subscriberContentExcluded'],1); self.assertEqual(result['subscriberExcludedTweetIds'],['100'])
        self.assertEqual(result['accepted'],0); self.assertEqual(emitted,[]); self.assertEqual(requests,['100'])
    async def test_subscriber_exclusion_never_supplies_coverage_boundary(self):
        requests=[]; pages=[]
        async def fetch(cur): pages.append(cur); return page([subscriber_item(tweet()),cursor('p'+str(len(pages)))])
        async def canonical(identifier): requests.append(identifier); return subscriber_detail(tweet())
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},fetch_detail=canonical)
        self.assertFalse(result['complete']); self.assertEqual(result['reason'],'page_limit_reached')
        self.assertEqual(result['subscriberContentExcluded'],1); self.assertEqual(requests,['100'])
    async def test_subscriber_proof_requires_requested_focal_exact_cta_and_official_author_url(self):
        for change in ('no_cta','title','foreign_host','wrong_author_path','http','credentials','missing_date','wrong_id','nested_quote'):
            with self.subTest(change=change):
                body=subscriber_detail(tweet()); entry=body['data']['threaded_conversation_with_injections_v2']['instructions'][0]['entries'][0]
                raw=entry['content']['itemContent']['tweet_results']['result']
                if change=='no_cta': raw.pop('cta')
                elif change=='title': raw['cta']['title']='Show more'
                elif change=='foreign_host': raw['cta']['url']['url']='https://example.com/Alice/superfollows/subscribe'
                elif change=='wrong_author_path': raw['cta']['url']['url']='https://x.com/Other/superfollows/subscribe'
                elif change=='http': raw['cta']['url']['url']='http://x.com/Alice/superfollows/subscribe'
                elif change=='credentials': raw['cta']['url']['url']='https://person@x.com/Alice/superfollows/subscribe'
                elif change=='missing_date': raw['tweet'].pop('created_at')
                elif change=='wrong_id': raw['tweet']['rest_id']='101'
                else:
                    root=tweet('99'); root['quoted_status_result']={'result':raw}; body=detail(root)
                async def fetch(cur): return page([subscriber_item(tweet()),cursor('')])
                async def canonical(identifier): return body
                result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},fetch_detail=canonical)
                self.assertFalse(result['complete']); self.assertEqual(result['tweets'],[])
    async def test_cycle_subscriber_exclusions_deduplicate_main_and_reply(self):
        account={'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'}
        async def resolve(value): return value
        async def fetch(value,kind,cur): return page([subscriber_item(tweet()),cursor('')])
        async def canonical(value,identifier): return subscriber_detail(tweet())
        completed=[]
        await self.c.scan_cycle([account],resolve,fetch,on_complete=completed.append,fetch_detail=canonical)
        self.assertEqual(completed[0]['subscriberContentExcluded'],1); self.assertEqual(completed[0]['subscriberExcludedTweetIds'],['100'])
        self.assertTrue(completed[0]['complete']); self.assertTrue(completed[0]['replyCoverageComplete'])
    async def test_nested_canonical_quote_cannot_confirm_requested_focal(self):
        root=tweet('99'); root['quoted_status_result']={'result':tweet('100')}
        async def fetch(cur): return page([conversation([tweet('100')]),cursor('')])
        async def canonical(identifier): return detail(root)
        result=await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5,fetch_detail=canonical)
        self.assertFalse(result['complete']); self.assertEqual(result['tweets'],[])
    async def test_canonical_request_pause_retains_incomplete_scan(self):
        async def fetch(cur): return page([conversation([tweet('100')]),cursor('')])
        async def canonical(identifier): raise self.c.ReaderStop('request_budget_reached')
        with self.assertRaises(self.c.ReaderStop) as caught:
            await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5,fetch_detail=canonical)
        self.assertFalse(caught.exception.account_result['complete'])
        self.assertEqual(caught.exception.account_result['pages'],1)
    async def test_canonical_pause_keeps_already_verified_standalone_items(self):
        async def fetch(cur): return page([item(tweet('101')),conversation([tweet('100')]),cursor('')])
        async def canonical(identifier): raise self.c.ReaderStop('request_budget_reached')
        emitted=[]
        with self.assertRaises(self.c.ReaderStop) as caught:
            await self.c.scan_account(fetch,{'username':'Alice','userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'},5,on_tweet=emitted.append,fetch_detail=canonical)
        self.assertEqual([event['feedItem']['id'] for event in emitted],['101'])
        self.assertEqual(caught.exception.account_result['accepted'],1)
    async def test_global_cycle_checks_all_seven_main_windows_before_first_reply(self):
        accounts=[{'username':'Alice'+str(index),'userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'} for index in range(7)]
        operations=[]; completed=[]
        async def resolve(account): return account
        async def fetch(account,kind,cur):
            operations.append((kind,account['username']))
            return page([item(tweet(str(100+len(operations)),username=account['username'])),cursor('')])
        await self.c.scan_cycle(accounts,resolve,fetch,max_pages=5,on_complete=completed.append)
        self.assertEqual(operations[:7],[('posts','Alice'+str(index)) for index in range(7)])
        self.assertEqual(operations[7],('replies','Alice0'))
        self.assertEqual(len(completed),7); self.assertTrue(all(result['complete'] for result in completed))
        self.assertTrue(all(result['pages']==2 for result in completed))
    async def test_reply_budget_pause_emits_all_completed_main_accounts_once(self):
        accounts=[{'username':'Alice'+str(index),'userId':'7','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'} for index in range(7)]
        operations=[]; completed=[]; tweets=[]
        async def resolve(account): return account
        async def fetch(account,kind,cur):
            operations.append((kind,account['username']))
            if kind=='replies': raise self.c.ReaderStop('request_budget_reached','2026-10-04T02:00:00Z')
            return page([item(tweet(str(100+len(operations)),username=account['username'])),cursor('')])
        with self.assertRaises(self.c.ReaderStop):
            await self.c.scan_cycle(accounts,resolve,fetch,max_pages=5,on_tweet=tweets.append,on_complete=completed.append)
        self.assertEqual(operations[:7],[('posts','Alice'+str(index)) for index in range(7)])
        self.assertEqual(len(completed),7); self.assertEqual(len(tweets),7)
        self.assertEqual(len({result['username'] for result in completed}),7)
        self.assertTrue(all(result['complete'] and not result['replyCoverageComplete'] for result in completed))
        self.assertTrue(all(result['replyReason']=='request_budget_reached' for result in completed))

class Protocol(unittest.TestCase):
    def setUp(self): self.c = load_core()
    def test_invalid_task_bounds_rejected(self):
        valid = {'version':1,'runId':'r','sessionDbPath':'/private/db','cooldownFilePath':'/private/cooldown','maxRequests':80,'deadlineMs':180000,'minIntervalMs':2000,'maxPages':5,'accounts':[{'username':'Alice','fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'}]}
        self.c.validate_task(valid)
        for name, value in [('maxRequests',81),('deadlineMs',180001),('minIntervalMs',1999),('maxPages',6),('version',2)]:
            bad=deepcopy(valid); bad[name]=value
            with self.subTest(name=name), self.assertRaises(ValueError): self.c.validate_task(bad)
    def test_missing_session_protocol_never_echoes_input_secret(self):
        task={'version':1,'runId':'r','mode':'doctor','sessionDbPath':'/does-not-exist/secret-cookie','cooldownFilePath':'/does-not-exist/cooldown'}
        result=subprocess.run([sys.executable,str(ROOT/'x-owned-reader-bridge.py')], input=json.dumps(task),text=True,capture_output=True)
        events=[json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(events[-1]['type'], 'cycle_complete')
        self.assertNotIn('secret-cookie', result.stdout+result.stderr)
        self.assertEqual(result.returncode,0)
    def test_protocol_timestamps_use_bounded_fractional_utc_format(self):
        self.assertRegex(self.c.iso_now(),r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        self.assertRegex(self.c.RequestGate.to_iso(1791072000.123456),r'^2026-10-04T00:00:00\.123Z$')
    def test_doctor_respects_existing_endpoint_lock_without_mutation(self):
        import sqlite3
        bridge=load_bridge()
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'accounts.db'; future='2099-01-01T00:00:00Z'
            locks=json.dumps({'TweetDetail':future,'OtherEndpoint':future})
            with closing(sqlite3.connect(db)) as connection:
                connection.execute('CREATE TABLE accounts(active INTEGER,locks TEXT)')
                connection.execute('INSERT INTO accounts VALUES(1,?)',(locks,)); connection.commit()
            status=bridge.session_status(db)
            self.assertTrue(status['sessionAvailable']); self.assertGreater(status['until'],time.time())
            with closing(sqlite3.connect(db)) as connection: self.assertEqual(connection.execute('SELECT locks FROM accounts').fetchone()[0],locks)
    def test_malformed_private_cooldown_is_sanitized_and_finishes_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            cooldown=Path(directory)/'cooldown.json'; cooldown.write_text('["secret-cookie-value"]')
            task={'version':1,'runId':'safe-run','mode':'doctor','sessionDbPath':str(Path(directory)/'missing.db'),'cooldownFilePath':str(cooldown)}
            result=subprocess.run([sys.executable,str(ROOT/'x-owned-reader-bridge.py')],input=json.dumps(task),text=True,capture_output=True)
            self.assertEqual(result.stderr,''); self.assertNotIn('secret-cookie-value',result.stdout)
            events=[json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(events[-1]['type'],'cycle_complete')

try:
    import httpx
except ImportError:
    httpx = None

@unittest.skipIf(httpx is None, 'HTTPx transport tests run in pinned Linux SDK venv')
class Transport(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        asyncio.get_running_loop().slow_callback_duration=1
        self.c=load_core(); self.temp=tempfile.TemporaryDirectory(); self.path=Path(self.temp.name)/'cooldown.json'; self.received=[]; self.replies=[]
        async def serve(reader, writer):
            request=await reader.readuntil(b'\r\n\r\n'); self.received.append((time.monotonic(),request.decode().splitlines()[0]))
            status, headers, body = self.replies.pop(0)
            wire=f'HTTP/1.1 {status} Response\r\nConnection: close\r\nContent-Length: {len(body)}\r\n'+''.join(f'{k}: {v}\r\n' for k,v in headers.items())+'\r\n'
            writer.write(wire.encode()+body); await writer.drain(); writer.close(); await writer.wait_closed()
        self.server=await asyncio.start_server(serve,'127.0.0.1',0); self.port=self.server.sockets[0].getsockname()[1]; self.url=f'http://127.0.0.1:{self.port}/graphql/test'
        self.client=httpx.AsyncClient(follow_redirects=True,transport=httpx.AsyncHTTPTransport(retries=0))
    async def asyncTearDown(self):
        await self.client.aclose(); self.server.close(); await self.server.wait_closed(); self.temp.cleanup()
    def gate(self, **kw): return self.c.RequestGate(self.path, allowed_origins={('http','127.0.0.1',self.port)}, **kw)
    async def get(self, gate, url=None, **kw): return await gate.request(self.client.request,'GET',url or self.url,**kw)
    async def test_real_wire_budget_counts_redirects_and_spaces_starts(self):
        self.replies=[(302,{'location':'/graphql/next'},b''),(200,{},b'{"data":{"ok":true}}')]
        gate=self.gate(max_requests=2); await self.get(gate)
        with self.assertRaises(self.c.ReaderStop) as stopped: await self.get(gate)
        self.assertIsNotNone(stopped.exception.next_retry_at)
        self.assertGreater(self.c.instant(stopped.exception.next_retry_at),time.time())
        self.assertFalse(self.path.exists())
        self.assertEqual(len(self.received),2); self.assertGreaterEqual(self.received[1][0]-self.received[0][0],1.9)
        self.assertEqual(gate.count,2)
    async def test_auth_rate_limit_errors_and_malformed_json_pause_no_second_wire(self):
        cases=[(401,{},b'', 'login_or_access_challenge'),(403,{},b'', 'login_or_access_challenge'),(429,{'x-rate-limit-reset':str(int(time.time())+900)},b'', 'rate_limited'),(200,{},b'{"errors":[{"code":88}],"data":{}}','rate_limited'),(200,{},b'not json','unexpected_api_response'),(200,{},b'{"errors":[{"message":"secret-value"}],"data":{}}','unexpected_api_response')]
        for status,headers,body,want in cases:
            with self.subTest(status=status,want=want):
                if self.path.exists(): self.path.unlink()
                self.replies=[(status,headers,body)]; before=len(self.received); gate=self.gate()
                with self.assertRaises(self.c.ReaderStop) as stopped: await self.get(gate)
                self.assertEqual(stopped.exception.reason,want)
                with self.assertRaises(self.c.ReaderStop): await self.get(gate)
                self.assertEqual(len(self.received),before+1)
                self.assertNotIn('secret-value',self.path.read_text())
    async def test_cross_origin_and_auth_redirects_never_follow(self):
        for location,want in [('https://evil.test/','unexpected_cross_origin_redirect'),('/i/flow/login','login_or_access_challenge')]:
            if self.path.exists(): self.path.unlink()
            self.replies=[(302,{'location':location},b'')]; gate=self.gate(); before=len(self.received)
            with self.assertRaises(self.c.ReaderStop) as stopped: await self.get(gate)
            self.assertEqual(stopped.exception.reason,want); self.assertEqual(len(self.received),before+1)
    async def test_cooldown_survives_process_gate_recreation_and_cannot_be_shortened(self):
        self.path.write_text(json.dumps({'until':time.time()+1800,'reason':'rate_limited'})); original=json.loads(self.path.read_text())['until']
        gate=self.gate()
        with self.assertRaises(self.c.ReaderStop): await self.get(gate)
        self.assertEqual(self.received,[]); self.assertGreaterEqual(json.loads(self.path.read_text())['until'],original)
    async def test_retry_after_header_is_respected_when_rate_reset_is_absent(self):
        self.replies=[(429,{'retry-after':'1200'},b'')]; gate=self.gate(); before=time.time()
        with self.assertRaises(self.c.ReaderStop) as stopped: await self.get(gate)
        self.assertGreaterEqual(self.c.instant(stopped.exception.next_retry_at),before+1199)
    async def test_deadline_checked_after_throttle_before_wire(self):
        self.replies=[(200,{},b'{"data":{"ok":true}}')]; gate=self.gate(deadline_ms=100)
        await self.get(gate)
        with self.assertRaises(self.c.ReaderStop) as stopped: await self.get(gate)
        self.assertEqual(stopped.exception.reason,'cycle_deadline_reached'); self.assertEqual(len(self.received),1)
        self.assertIsNotNone(stopped.exception.next_retry_at)
    async def test_sdk_bootstrap_client_disables_transport_retry_and_automatic_redirect(self):
        try: from twscrape.http import HttpxClient
        except ImportError: self.skipTest('requires pinned twscrape Linux venv')
        bridge=load_bridge(); gate=self.gate(max_requests=1)
        self.replies=[(302,{'location':'/graphql/next'},b'')]
        with bridge.sdk_guards(gate):
            client=HttpxClient()
            try:
                self.assertFalse(client._client.follow_redirects)
                self.assertEqual(client._client._transport._pool._retries,0)
                with self.assertRaises(self.c.ReaderStop): await client.get(self.url)
                self.assertEqual(len(self.received),1)
            finally: await client.aclose()
    async def test_sdk_logged_out_bootstrap_permanently_pauses_before_asset_requests(self):
        try:
            import twscrape.xclid as xclid
            from twscrape.http import HttpxClient
        except ImportError: self.skipTest('requires pinned twscrape Linux venv')
        from unittest.mock import patch
        bridge=load_bridge(); gate=self.gate()
        html='<html><head><script src="https://abs.twimg.com/x-web/entry-client-logged-out-abc.js"></script></head></html>'
        async def offline_page(url,client): return html
        with bridge.sdk_guards(gate), patch.object(xclid,'get_tw_page_text',offline_page):
            with self.assertRaises(self.c.ReaderStop) as stopped:
                await xclid.XClIdGen.create()
        self.assertEqual(stopped.exception.reason,'login_or_access_challenge')
        self.assertIsNone(stopped.exception.next_retry_at)
        self.assertEqual(gate.count,0)
        self.assertEqual(json.loads(self.path.read_text()),{'reason':'login_or_access_challenge','until':None})
    async def test_sdk_queue_exit_marks_logged_out_fixture_inactive_and_retains_locks(self):
        try:
            from twscrape import API
            import twscrape.api as api_module
            import twscrape.xclid as xclid
        except ImportError: self.skipTest('requires pinned twscrape Linux venv')
        from unittest.mock import patch
        import sqlite3
        from loguru import logger
        logger.remove()
        bridge=load_bridge(); gate=self.gate(); db=Path(self.temp.name)/'fixture-session.db'
        api=API(str(db),raise_when_no_account=True,wait_timeout=0,debug=False)
        await api.pool.add_account_cookies('offline_fixture','auth_token=fictional-test-value; ct0=fictional-test-value')
        other='2099-01-01 00:00:00'
        with closing(sqlite3.connect(db)) as connection:
            connection.execute('UPDATE accounts SET locks=?',(json.dumps({'UnrelatedEndpoint':other}),)); connection.commit()
        html='<script src="https://abs.twimg.com/x-web/entry-client-logged-out-abc.js"></script>'
        async def offline_page(url,client): return html
        with bridge.sdk_guards(gate),patch.object(xclid,'get_tw_page_text',offline_page):
            with self.assertRaises(self.c.ReaderStop) as stopped:
                await api._gql_item(api_module.OP_UserTweets,{'userId':'7','count':40})
        self.assertEqual(stopped.exception.reason,'login_or_access_challenge'); self.assertEqual(gate.count,0)
        with closing(sqlite3.connect(db)) as connection:
            active,locks,message=connection.execute('SELECT active,locks,error_msg FROM accounts').fetchone()
        self.assertEqual(active,0); self.assertEqual(message,'Owned reader authentication check failed')
        locks=json.loads(locks); self.assertEqual(locks['UnrelatedEndpoint'],other)
        self.assertIn('UserTweets',locks)
    async def bridge_main_first_fixture(self,incomplete=False):
        try: import twscrape
        except ImportError: self.skipTest('requires pinned twscrape Linux venv')
        from unittest.mock import patch
        from types import SimpleNamespace
        bridge=load_bridge(); operations=[]; events=[]
        accounts=[{'username':'Alice'+str(index),'userId':str(7+index),'fromAt':'2026-10-03T00:00:00Z','throughAt':'2026-10-04T01:00:00Z'} for index in range(7)]
        task={'version':1,'runId':'fixture','sessionDbPath':'offline-unused.db','cooldownFilePath':str(self.path),'maxRequests':80,'deadlineMs':180000,'minIntervalMs':2000,'maxPages':5,'accounts':accounts}
        class FixtureAPI:
            def __init__(self,*args,**kwargs): pass
            async def _gql_item(self,operation,variables):
                kind='posts' if operation.endswith('/UserTweets') else 'replies'
                index=int(variables['userId'])-7; operations.append((kind,index))
                if kind=='replies': raise bridge.core.ReaderStop('request_budget_reached','2026-10-04T02:00:00Z')
                body={'data':{}} if incomplete and index==3 else page([item(tweet(str(100+index),username='Alice'+str(index),user_id=str(7+index))),cursor('')])
                return SimpleNamespace(json=lambda:body)
        def emit(kind,**fields): events.append({'type':kind,**fields})
        with patch.object(bridge,'session_status',lambda _: {'sessionAvailable':True,'until':None}),patch.object(bridge,'sdk_version',lambda:'0.20.1'),patch.object(twscrape,'API',FixtureAPI):
            await bridge.run(task,emit)
        return operations,events
    async def test_bridge_optional_reply_budget_finishes_without_global_pause(self):
        operations,events=await self.bridge_main_first_fixture()
        self.assertEqual(operations[:7],[('posts',index) for index in range(7)])
        self.assertEqual(operations[7],('replies',0))
        completions=[event for event in events if event['type']=='account_complete']
        self.assertEqual(len(completions),7); self.assertTrue(all(event['complete'] for event in completions))
        self.assertTrue(all(event['replyReason']=='request_budget_reached' for event in completions))
        self.assertFalse(any(event['type']=='paused' for event in events)); self.assertEqual(events[-1]['type'],'cycle_complete')
    async def test_bridge_main_incomplete_keeps_global_budget_pause(self):
        operations,events=await self.bridge_main_first_fixture(incomplete=True)
        self.assertEqual(operations[:7],[('posts',index) for index in range(7)])
        completions=[event for event in events if event['type']=='account_complete']
        self.assertEqual(sum(event['complete'] for event in completions),6)
        pauses=[event for event in events if event['type']=='paused']
        self.assertEqual(len(pauses),1); self.assertEqual(pauses[0]['reason'],'request_budget_reached')
        self.assertEqual(events[-1]['type'],'cycle_complete')

if __name__ == '__main__': unittest.main(verbosity=2)
