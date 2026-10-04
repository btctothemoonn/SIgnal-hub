"""Pure timeline selection, pagination, and bounded HTTP transport policy."""
import asyncio
from datetime import datetime, timezone
import email.utils
import json
import math
import os
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse

USERNAME = re.compile(r'[A-Za-z0-9_]{1,15}')
IDENTIFIER = re.compile(r'[1-9][0-9]{0,24}')

def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def instant(value):
    if not isinstance(value, str): raise ValueError('invalid_date')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None: raise ValueError('invalid_date')
    return result.timestamp()

def validate_task(task):
    if not isinstance(task, dict) or task.get('version') != 1: raise ValueError('invalid_protocol')
    if not isinstance(task.get('runId'), str) or not 1 <= len(task['runId']) <= 128: raise ValueError('invalid_run_id')
    for key in ('sessionDbPath', 'cooldownFilePath'):
        if not isinstance(task.get(key), str) or not task[key] or len(task[key]) > 4096: raise ValueError('invalid_private_path')
    if task.get('mode') == 'doctor': return task
    for key, low, high in [('maxRequests',1,80),('deadlineMs',1,180000),('minIntervalMs',2000,180000),('maxPages',1,5)]:
        value = task.get(key)
        if type(value) is not int or not low <= value <= high: raise ValueError('invalid_budget')
    accounts = task.get('accounts')
    if not isinstance(accounts, list) or not 1 <= len(accounts) <= 7: raise ValueError('invalid_accounts')
    names = set()
    for account in accounts:
        if not isinstance(account, dict) or not USERNAME.fullmatch(account.get('username', '')): raise ValueError('invalid_account')
        name = account['username'].lower()
        if name in names: raise ValueError('duplicate_account')
        names.add(name)
        if account.get('userId') is not None and not IDENTIFIER.fullmatch(str(account['userId'])): raise ValueError('invalid_user_id')
        if instant(account.get('fromAt')) >= instant(account.get('throughAt')): raise ValueError('invalid_window')
    return task

def unwrap(result):
    if not isinstance(result, dict): return {}
    if result.get('__typename') == 'TweetWithVisibilityResults':
        result = result.get('tweet')
        # X sometimes omits the child typename in this explicit full-tweet wrapper.
        # This exception never applies to arbitrary untyped nodes or preview wrappers.
        if isinstance(result,dict) and '__typename' not in result:
            identifier=str(result.get('rest_id','')); legacy=result.get('legacy'); author=tweet_author(result)
            if not IDENTIFIER.fullmatch(identifier) or not isinstance(legacy,dict) or author is None: return {}
            if legacy.get('id_str')!=identifier or legacy.get('user_id_str')!=author['userId']: return {}
            if legacy.get('truncated') is True and 'note_tweet' not in result: return {}
            text=nested(result,'note_tweet','note_tweet_results','result','text') if 'note_tweet' in result else legacy.get('full_text')
            if not isinstance(text,str): return {}
            try:
                created=email.utils.parsedate_to_datetime(legacy.get('created_at'))
                if created.tzinfo is None: return {}
            except (TypeError,ValueError,OverflowError): return {}
            result={**result,'__typename':'Tweet'}
    return result if isinstance(result, dict) and result.get('__typename') == 'Tweet' else {}

def nested(obj, *keys):
    for key in keys:
        if not isinstance(obj, dict): return None
        obj = obj.get(key)
    return obj

def timeline_instructions(body):
    # Deliberately follow known timeline paths; never recurse into quoted tweets.
    user = nested(body, 'data', 'user', 'result')
    for path in [('timeline_v2','timeline','instructions'),('timeline','timeline','instructions'),('timeline','instructions'),('timeline_response','timeline','instructions')]:
        value = nested(user, *path)
        if isinstance(value, list): return value
    return None

def tweet_author(result):
    user = nested(result, 'core', 'user_results', 'result')
    if not isinstance(user, dict): return None
    legacy, core = user.get('legacy', {}), user.get('core', {})
    username = core.get('screen_name') or legacy.get('screen_name')
    identifier = str(user.get('rest_id', ''))
    if not isinstance(username, str) or not USERNAME.fullmatch(username) or not IDENTIFIER.fullmatch(identifier): return None
    return {'username':username,'userId':identifier,'displayName':core.get('name') or legacy.get('name') or username,
            'userAvatar': nested(user, 'avatar', 'image_url') or legacy.get('profile_image_url_https') or ''}

def candidate_outside_window(result,identifier,user_id,lower,upper):
    # Only raw identity/date evidence can exclude a candidate, never module order.
    if isinstance(result,dict) and result.get('__typename')=='TweetPreviewDisplay': result=result.get('tweet')
    else: result=unwrap(result)
    if not isinstance(result,dict) or str(result.get('rest_id',''))!=identifier: return False
    author=tweet_author(result)
    if author is None: return False
    legacy=result.get('legacy') or {}
    if str(legacy.get('user_id_str',author['userId']))!=author['userId']: return False
    raw_date=legacy.get('created_at') or result.get('created_at')
    try:
        created=email.utils.parsedate_to_datetime(raw_date)
        if created.tzinfo is None: return False
        timestamp=created.timestamp()
    except (TypeError,ValueError,OverflowError): return False
    return author['userId']!=str(user_id) or timestamp<lower or timestamp>upper

def snowflake_timestamp(identifier):
    # Twitter's published Snowflake epoch and 22-bit worker/sequence suffix.
    # Restrict this fallback to modern signed-64-bit IDs from allTweetIds.
    if not isinstance(identifier,str) or not re.fullmatch(r'[1-9][0-9]{17,18}',identifier): return None
    value=int(identifier)
    if value>=1<<63: return None
    timestamp=((value>>22)+1288834974657)/1000
    if not 1293840000<=timestamp<=time.time()+60: return None
    return timestamp

def snowflake_outside_window(identifier,lower,upper):
    timestamp=snowflake_timestamp(identifier)
    # Leave a minute before the lower edge for clock and timestamp precision.
    # An edit ID can postdate throughAt while its original creation is in-window.
    # Exclusion never establishes author, full content, focal position, or boundary.
    return timestamp is not None and timestamp+60<lower

def media_items(result):
    media = nested(result, 'legacy', 'extended_entities', 'media') or []
    if not isinstance(media, list): raise ValueError('invalid_media')
    output = []
    for item in media:
        if not isinstance(item, dict): raise ValueError('invalid_media')
        kind = {'photo':'image','video':'video','animated_gif':'gif'}.get(item.get('type'))
        url = item.get('media_url_https')
        if kind is None or not isinstance(url, str) or not url.startswith('https://'): raise ValueError('invalid_media')
        info = item.get('original_info') or nested(item,'sizes','large') or {}
        width,height=info.get('width',info.get('w')),info.get('height',info.get('h'))
        output.append({'kind':kind,'mimeType':'image/jpeg' if kind=='image' else 'video/mp4','previewUrl':url,
                       'label':item.get('ext_alt_text') or kind,'width':width if type(width) is int and width>=0 else None,'height':height if type(height) is int and height>=0 else None})
    return output

def tweet_feed(result, parents=None, depth=0):
    result = unwrap(result)
    if not result or depth > 3: raise ValueError('unparsed_entry')
    identifier, author, legacy = str(result.get('rest_id','')), tweet_author(result), result.get('legacy')
    if not IDENTIFIER.fullmatch(identifier) or author is None or not isinstance(legacy,dict): raise ValueError('unparsed_entry')
    if str(legacy.get('id_str',identifier)) != identifier or str(legacy.get('user_id_str',author['userId'])) != author['userId']: raise ValueError('author_mismatch')
    note = result.get('note_tweet')
    if note is not None:
        text = nested(note,'note_tweet_results','result','text')
        if not isinstance(text,str): raise ValueError('incomplete_content')
    else:
        text = legacy.get('full_text')
        if legacy.get('truncated') is True: raise ValueError('incomplete_content')
    if not isinstance(text,str): raise ValueError('incomplete_content')
    try:
        created = email.utils.parsedate_to_datetime(legacy['created_at'])
        if created.tzinfo is None: raise ValueError('invalid_date')
    except (KeyError, TypeError, ValueError): raise ValueError('invalid_date') from None
    username = author['username']
    output = {'id':identifier,'userId':author['userId'],'text':text,'createdAt':created.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),
              'username':username,'displayName':author['displayName'],'profileUrl':f'https://x.com/{username}',
              'userAvatar':author['userAvatar'],'tweetUrl':f'https://x.com/{username}/status/{identifier}',
              'media':media_items(result),'translation':None,'quotedTweet':None,'contentSource':'owned-reader','contentComplete':True,
              'origin':'watch','queryLabel':'owned-reader / full','hashtags':[],
              'likes':0,'retweets':0,'replies':0,'quotes':0,'views':0}
    for output_key, source in [('likes','favorite_count'),('retweets','retweet_count'),('replies','reply_count'),('quotes','quote_count')]:
        value = legacy.get(source,0); output[output_key] = value if type(value) is int and value >= 0 else 0
    views = nested(result,'views','count')
    if isinstance(views,(str,int)) and str(views).isdigit(): output['views']=int(views)
    output['hashtags']=[x['text'] for x in nested(legacy,'entities','hashtags') or [] if isinstance(x,dict) and isinstance(x.get('text'),str)]
    quote = nested(result,'quoted_status_result','result') or nested(legacy,'quoted_status_result','result')
    relation = 'quote'
    reply_id = legacy.get('in_reply_to_status_id_str')
    if reply_id:
        output['inReplyToTweetId'] = str(reply_id)
        output['inReplyToUsername'] = legacy.get('in_reply_to_screen_name')
        output['eventType'] = 'NEW_TWEET_REPLY'
    if quote is None and reply_id and parents:
        quote = parents.get(str(reply_id)); relation='reply'
    if quote:
        try:
            context = tweet_feed(quote, depth=depth+1)
            output['quotedTweet'] = {key:context[key] for key in ('id','text','createdAt','username','displayName','profileUrl','userAvatar','tweetUrl','media','translation')}
            output['quotedTweet']['relation']=relation
            output['quotedTweet']['contentComplete']=True
            output['quotedTweet']['contentSource']='owned-reader'
            if context.get('contentVersion'): output['quotedTweet']['contentVersion']=context['contentVersion']
        except ValueError:
            # Inaccessible context is explicitly incomplete; never invent full text.
            output['contextComplete']=False
    elif legacy.get('quoted_status_id_str'):
        output['contextComplete']=False
    if quote and relation=='quote': output['eventType']='NEW_TWEET_QUOTE'
    if 'eventType' not in output: output['eventType']='NEW_TWEET'
    control = result.get('edit_control') or legacy.get('edit_control')
    identifiers = control.get('edit_tweet_ids') if isinstance(control,dict) else None
    if isinstance(identifiers,list) and len(identifiers)>1 and all(isinstance(x,str) and IDENTIFIER.fullmatch(x) for x in identifiers) and identifier==identifiers[-1]:
        output['contentVersion']=identifier
    return output

def parse_timeline_page(body, username, user_id, from_at, through_at):
    output = {'tweets':[],'quarantined':0,'complete':False,'cursor':None,'reason':None,'boundary':False,'terminated':False,'resolutions':[],'subscriberExcludedTweetIds':[]}
    instructions = timeline_instructions(body)
    if instructions is None:
        output['reason']='timeline_structure_unrecognized'; return output
    entries, terminated, cursor_seen = [], False, False
    for instruction in instructions:
        if not isinstance(instruction,dict): output['reason']='timeline_structure_unrecognized'; output['quarantined']+=1; continue
        kind=instruction.get('type')
        if kind=='TimelineTerminateTimeline' and instruction.get('direction')=='Bottom': terminated=True
        elif kind in ('TimelineAddEntries','TimelinePinEntry','TimelineReplaceEntry'):
            values=instruction.get('entries') if kind=='TimelineAddEntries' else [instruction.get('entry')]
            if not isinstance(values,list): output['quarantined']+=1; output['reason']='timeline_structure_unrecognized'; continue
            entries.extend((value, kind=='TimelinePinEntry') for value in values)
        elif kind in ('TimelineClearCache','TimelineShowAlert','TimelineShowCover'): continue
        else: output['quarantined']+=1; output['reason']='timeline_structure_unrecognized'
    lower, upper = instant(from_at), instant(through_at)
    for entry, pin_instruction in entries:
        if not isinstance(entry,dict): output['quarantined']+=1; output['reason']='unparsed_entry'; continue
        entry_id, content = str(entry.get('entryId','')),entry.get('content') or {}
        if not isinstance(content,dict): output['quarantined']+=1; output['reason']='unparsed_entry'; continue
        entry_type = content.get('entryType') or content.get('__typename')
        if entry_type=='TimelineTimelineCursor':
            if content.get('cursorType')=='Bottom':
                value=content.get('value')
                if not isinstance(value,str): output['quarantined']+=1; output['reason']='unparsed_entry'
                else: output['cursor']=value or None; cursor_seen=True; terminated |= value==''
            continue
        if entry_id.startswith(('who-to-follow-','promoted-','messageprompt-')): continue
        candidates, parents, selection = [], {}, 'standalone'
        if entry_type=='TimelineTimelineItem':
            item_content=content.get('itemContent') or {}
            if not isinstance(item_content,dict): item_content={}
            if item_content.get('promotedMetadata'): continue
            candidates=[(nested(item_content,'tweet_results','result'),item_content)]
        elif entry_type=='TimelineTimelineModule':
            metadata=nested(content,'metadata','conversationMetadata') or {}
            focal=metadata.get('focalTweetId') if isinstance(metadata,dict) else None
            values=content.get('items') or content.get('moduleItems')
            if content.get('displayType')!='VerticalConversation' or not isinstance(focal,str) or not IDENTIFIER.fullmatch(focal) or not isinstance(values,list):
                identifiers=metadata.get('allTweetIds') if isinstance(metadata,dict) else None
                if content.get('displayType')=='VerticalConversation' and isinstance(identifiers,list) and identifiers and len(identifiers)<=50 and all(isinstance(value,str) and IDENTIFIER.fullmatch(value) for value in identifiers):
                    inline={}
                    for module_item in values if isinstance(values,list) else []:
                        raw=nested(module_item,'item','itemContent','tweet_results','result')
                        unwrapped=raw.get('tweet') if isinstance(raw,dict) and raw.get('__typename')=='TweetPreviewDisplay' else unwrap(raw)
                        if isinstance(unwrapped,dict): inline[str(unwrapped.get('rest_id',''))]=raw
                    required=[identifier for identifier in dict.fromkeys(identifiers) if not candidate_outside_window(inline.get(identifier),identifier,user_id,lower,upper) and not (identifier not in inline and snowflake_outside_window(identifier,lower,upper))]
                    if not required: continue
                    output['resolutions'].append({'entryId':entry_id,'identifiers':required})
                output['quarantined']+=1; output['reason']='unknown_conversation_module'; continue
            selection='focal'
            for module_item in values:
                item_content=nested(module_item,'item','itemContent') or {}
                result=nested(item_content,'tweet_results','result'); unwrapped=unwrap(result)
                identifier=str(unwrapped.get('rest_id',''))
                if identifier: parents[identifier]=unwrapped
                if identifier==focal: candidates.append((result,item_content))
            if len(candidates)!=1: output['quarantined']+=1; output['reason']='unknown_conversation_module'; continue
        else: output['quarantined']+=1; output['reason']='unparsed_entry'; continue
        for result, item_content in candidates:
            raw_result=result
            result=unwrap(result)
            if not result:
                match=re.fullmatch(r'tweet-([1-9][0-9]{0,24})',entry_id)
                if match and entry_type=='TimelineTimelineItem':
                    if candidate_outside_window(raw_result,match[1],user_id,lower,upper): continue
                    output['resolutions'].append({'entryId':entry_id,'identifiers':[match[1]]})
                output['quarantined']+=1; output['reason']='unparsed_entry'; continue
            legacy=result.get('legacy') or {}
            if legacy.get('retweeted_status_result') or result.get('retweeted_status_result') or legacy.get('retweeted_status_id_str'):
                continue  # Native repost event semantics are outside this reader's coverage.
            try: feed=tweet_feed(result,parents)
            except ValueError: output['quarantined']+=1; output['reason']='unparsed_entry'; continue
            if feed['userId']!=str(user_id) or feed['username'].lower()!=username.lower():
                output['quarantined']+=1; output['reason']='author_mismatch'; continue
            pinned=pin_instruction or nested(item_content,'socialContext','contextType')=='Pin'
            timestamp=instant(feed['createdAt'])
            if timestamp < lower:
                if not pinned and entry_type=='TimelineTimelineItem': output['boundary']=True
                continue
            if timestamp > upper: continue
            output['tweets'].append({'account':{'username':username,'userId':str(user_id)},'feedItem':feed,
              'evidence':{'entryId':entry_id,'entryType':entry_type,'selection':selection,'tweetId':feed['id'],'userId':str(user_id),'pinned':pinned}})
    output['terminated']=terminated
    output['complete'] = output['quarantined']==0 and (output['boundary'] or terminated)
    if not output['complete'] and output['reason'] is None and not cursor_seen: output['reason']='timeline_structure_unrecognized'
    return output

def subscriber_exclusion(result,identifier):
    # Called only for the exact requested standalone canonical entry. A preview
    # remains incomplete unless X explicitly offers this author's subscription.
    if not isinstance(result,dict) or result.get('__typename')!='TweetPreviewDisplay': return None
    tweet=result.get('tweet'); author=tweet_author(tweet) if isinstance(tweet,dict) else None
    if author is None or tweet.get('rest_id')!=identifier or not IDENTIFIER.fullmatch(identifier): return None
    cta=result.get('cta')
    if not isinstance(cta,dict) or cta.get('title')!='Subscribe to unlock': return None
    url=nested(cta,'url','url')
    if not isinstance(url,str): return None
    try:
        target=urlparse(url)
        if target.scheme!='https' or target.hostname!='x.com' or target.port is not None or target.username or target.password or target.query or target.fragment: return None
        if target.path.lower()!='/'+author['username'].lower()+'/superfollows/subscribe': return None
        created=email.utils.parsedate_to_datetime(tweet.get('created_at'))
        if created.tzinfo is None: return None
    except (TypeError,ValueError,OverflowError): return None
    return {'_excluded':'subscriber_content_excluded','id':identifier,'userId':author['userId'],'username':author['username'],
            'createdAt':created.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')}

def record_subscriber_exclusions(output,identifiers):
    output['subscriberExcludedTweetIds']=list(dict.fromkeys([*output.get('subscriberExcludedTweetIds',[]),*identifiers]))
    output['subscriberContentExcluded']=len(output['subscriberExcludedTweetIds'])

def canonical_tweet(body,identifier):
    instructions=nested(body,'data','threaded_conversation_with_injections_v2','instructions')
    if not isinstance(instructions,list): raise ValueError('canonical_structure_unrecognized')
    results=[]; parents={}
    for instruction in instructions:
        if not isinstance(instruction,dict) or instruction.get('type') not in ('TimelineAddEntries','TimelineReplaceEntry'): continue
        entries=instruction.get('entries') if instruction.get('type')=='TimelineAddEntries' else [instruction.get('entry')]
        if not isinstance(entries,list): continue
        for entry in entries:
            if not isinstance(entry,dict) or nested(entry,'content','entryType')!='TimelineTimelineItem': continue
            raw=nested(entry,'content','itemContent','tweet_results','result')
            if entry.get('entryId')=='tweet-'+identifier:
                excluded=subscriber_exclusion(raw,identifier)
                if excluded is not None: results.append(excluded); continue
            result=unwrap(raw)
            tweet_id=str(result.get('rest_id',''))
            if tweet_id: parents[tweet_id]=result
            if entry.get('entryId')=='tweet-'+identifier and tweet_id==identifier: results.append(result)
    if len(results)!=1: raise ValueError('canonical_focal_unconfirmed')
    result=results[0]; legacy=result.get('legacy') or {}
    if result.get('_excluded')=='subscriber_content_excluded': return result
    if result.get('retweeted_status_result') or legacy.get('retweeted_status_result') or legacy.get('retweeted_status_id_str'): return None
    return tweet_feed(result,parents)

async def resolve_timeline_page(page,account,fetch_detail,cache):
    for group in page['resolutions']:
        events=[]; confirmed=True
        for identifier in group['identifiers']:
            if identifier not in cache:
                try: cache[identifier]=canonical_tweet(await fetch_detail(identifier),identifier)
                except ValueError: cache[identifier]=False
            feed=cache[identifier]
            if feed is False: confirmed=False; continue
            if feed is None: continue
            if feed['userId']!=str(account['userId']) or feed['username'].lower()!=account['username'].lower(): continue
            timestamp=instant(feed['createdAt'])
            if not instant(account['fromAt'])<=timestamp<=instant(account['throughAt']): continue
            if feed.get('_excluded')=='subscriber_content_excluded':
                if identifier not in page['subscriberExcludedTweetIds']: page['subscriberExcludedTweetIds'].append(identifier)
                continue
            events.append({'account':{'username':account['username'],'userId':str(account['userId'])},'feedItem':feed,
              'evidence':{'entryId':'tweet-'+identifier,'entryType':'TimelineTimelineItem','selection':'focal','tweetId':identifier,'userId':str(account['userId']),'pinned':False,'requestKind':'TweetDetail','requestedTweetId':identifier,'sourceEntryId':group['entryId']}})
        page['tweets'].extend(events)
        if confirmed: page['quarantined']-=1
    if page['quarantined']==0:
        page['reason']=None; page['complete']=page['boundary'] or page['terminated']
    return page

async def scan_account(fetch_page, account, max_pages=5, on_tweet=None,fetch_detail=None,detail_cache=None):
    output={**account,'complete':False,'pages':0,'accepted':0,'quarantined':0,'reason':None,'checkedAt':iso_now(),'tweets':[],'subscriberContentExcluded':0,'subscriberExcludedTweetIds':[]}
    if detail_cache is None: detail_cache={}
    current=None; cursors=set(); ids=set(); incomplete_reason=None
    def consume(events):
        for event in events:
            identifier=event['feedItem']['id']
            if identifier in ids: continue
            ids.add(identifier); output['accepted']+=1; output['tweets'].append(event)
            if on_tweet: on_tweet(event)
    for _ in range(max_pages):
        try:
            body=await fetch_page(current)
        except ReaderStop as stopped:
            stopped.account_result=output; output['reason']=stopped.reason; output['checkedAt']=iso_now(); raise
        output['pages']+=1
        page=parse_timeline_page(body,account['username'],account['userId'],account['fromAt'],account['throughAt'])
        consume(page['tweets'])
        if fetch_detail and page['resolutions']:
            try: page=await resolve_timeline_page(page,account,fetch_detail,detail_cache)
            except ReaderStop as stopped:
                record_subscriber_exclusions(output,page['subscriberExcludedTweetIds'])
                output['quarantined']+=page['quarantined']; output['reason']=stopped.reason; output['checkedAt']=iso_now(); stopped.account_result=output; raise
        record_subscriber_exclusions(output,page['subscriberExcludedTweetIds'])
        output['quarantined']+=page['quarantined']
        if page['quarantined'] or page['reason']: incomplete_reason=incomplete_reason or page['reason']
        consume(page['tweets'])
        if page['boundary'] or page['complete']:
            output['complete']=page['complete'] and incomplete_reason is None
            output['reason']=None if output['complete'] else incomplete_reason or page['reason']; break
        following=page['cursor']
        if following is None: output['reason']=incomplete_reason or 'timeline_structure_unrecognized'; break
        if following in cursors: output['reason']=incomplete_reason or 'cursor_stalled'; break
        cursors.add(following); current=following
    else: output['reason']=incomplete_reason or 'page_limit_reached'
    output['checkedAt']=iso_now()
    return output

async def scan_coverage(fetch_page,account,max_pages=5,on_tweet=None,fetch_detail=None):
    seen=set(); detail_cache={}
    def emit(event):
        identifier=event['feedItem']['id']
        if identifier not in seen:
            seen.add(identifier)
            if on_tweet: on_tweet(event)
    async def posts(cursor): return await fetch_page('posts',cursor)
    main=await scan_account(posts,account,max_pages,emit,fetch_detail,detail_cache)
    main.update({'coverageKind':'posts-and-quotes','replyCoverageComplete':False,'replyReason':'reply_page_budget_unavailable','replyQuarantined':0})
    remaining=max_pages-main['pages']
    if remaining:
        async def replies(cursor): return await fetch_page('replies',cursor)
        try: reply=await scan_account(replies,account,remaining,emit,fetch_detail,detail_cache)
        except ReaderStop as stopped:
            partial=stopped.account_result or {}
            record_subscriber_exclusions(main,partial.get('subscriberExcludedTweetIds',[]))
            main['pages']+=partial.get('pages',0); main['accepted']=len(seen)
            main['replyQuarantined']=partial.get('quarantined',0); main['replyReason']=stopped.reason
            main['checkedAt']=iso_now(); stopped.account_result=main; raise
        main['pages']+=reply['pages']; main['replyQuarantined']=reply['quarantined']; main['accepted']=len(seen)
        record_subscriber_exclusions(main,reply['subscriberExcludedTweetIds'])
        main['replyCoverageComplete']=reply['complete']; main['replyReason']=reply['reason']; main['checkedAt']=reply['checkedAt']
    return main

async def scan_cycle(accounts,resolve_account,fetch_timeline,max_pages=5,on_tweet=None,on_complete=None,fetch_detail=None):
    """All authors' primary windows precede any supplemental reply request."""
    contexts=[]; seen=set(); stopped_reason=None
    def emit(event):
        key=(event['account']['username'].lower(),event['feedItem']['id'])
        if key not in seen:
            seen.add(key)
            if on_tweet: on_tweet(event)
    def shape(result):
        result.setdefault('coverageKind','posts-and-quotes')
        result.setdefault('replyCoverageComplete',False)
        result.setdefault('replyReason','reply_page_budget_unavailable')
        result.setdefault('replyQuarantined',0)
        record_subscriber_exclusions(result,[])
        return result
    try:
        for requested in accounts:
            account=await resolve_account(dict(requested))
            cache={}
            async def detail(identifier): return await fetch_detail(account,identifier)
            async def posts(cursor): return await fetch_timeline(account,'posts',cursor)
            if account.get('_skip_reason'):
                result={**account,'complete':False,'pages':0,'accepted':0,'quarantined':0,'reason':account['_skip_reason'],'checkedAt':iso_now(),'tweets':[]}
            else:
                try: result=await scan_account(posts,account,max_pages,emit,detail if fetch_detail else None,cache)
                except ReaderStop as stopped:
                    if stopped.account_result is not None: contexts.append({'account':account,'cache':cache,'result':shape(stopped.account_result)})
                    raise
            contexts.append({'account':account,'cache':cache,'result':shape(result)})
        for context in contexts:
            account,result,cache=context['account'],context['result'],context['cache']
            remaining=max_pages-result['pages']
            if not remaining or account.get('_skip_reason'): continue
            async def detail(identifier): return await fetch_detail(account,identifier)
            async def replies(cursor): return await fetch_timeline(account,'replies',cursor)
            try: reply=await scan_account(replies,account,remaining,emit,detail if fetch_detail else None,cache)
            except ReaderStop as stopped:
                partial=stopped.account_result or {}
                record_subscriber_exclusions(result,partial.get('subscriberExcludedTweetIds',[]))
                result['pages']+=partial.get('pages',0); result['replyQuarantined']=partial.get('quarantined',0)
                result['replyReason']=stopped.reason; result['checkedAt']=iso_now(); raise
            result['pages']+=reply['pages']; result['replyQuarantined']=reply['quarantined']
            record_subscriber_exclusions(result,reply['subscriberExcludedTweetIds'])
            result['replyCoverageComplete']=reply['complete']; result['replyReason']=reply['reason']; result['checkedAt']=reply['checkedAt']
    except ReaderStop as stopped:
        stopped_reason=stopped.reason; raise
    except asyncio.CancelledError:
        stopped_reason='cycle_deadline_reached'; raise
    finally:
        for context in contexts:
            result=context['result']; username=context['account']['username'].lower()
            result['accepted']=sum(name==username for name,_ in seen)
            if stopped_reason and not result['replyCoverageComplete'] and result['replyReason']=='reply_page_budget_unavailable': result['replyReason']=stopped_reason
            if on_complete: on_complete(result)
    return [context['result'] for context in contexts]

class ReaderStop(BaseException):
    """Bypass SDK retry/account-rotation catches, which catch Exception."""
    def __init__(self, reason, next_retry_at=None):
        self.reason=reason; self.next_retry_at=next_retry_at; self.account_result=None

def cooldown_state(path):
    path=Path(path)
    if not path.exists(): return None
    try:
        state=json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(state,dict): raise ValueError('invalid_cooldown')
        reason=state.get('reason','session_cooldown')
        if reason not in {'session_cooldown','rate_limited','login_or_access_challenge','network_error_paused','unexpected_api_response','unexpected_redirect','unexpected_cross_origin_redirect','unexpected_request_destination','redirect_limit_reached','cooldown_write_failed'}: reason='invalid_cooldown'
        until=state.get('until')
        if until is None:
            if state.get('reason'): return {'reason':reason,'until':None}
            raise ValueError('invalid_cooldown')
        if type(until) not in (int,float) or not math.isfinite(until): raise ValueError('invalid_cooldown')
        if until>time.time(): return {'reason':reason,'until':until}
        return None
    except (OSError,ValueError,TypeError): return {'reason':'invalid_cooldown','until':None}

class RequestGate:
    def __init__(self,cooldown_path,max_requests=80,deadline_ms=180000,min_interval_ms=2000,allowed_origins=None):
        self.cooldown_path=Path(cooldown_path); self.max_requests=min(max_requests,80); self.deadline=time.monotonic()+min(deadline_ms,180000)/1000
        self.min_interval=max(min_interval_ms,2000)/1000; self.count=0; self.last=None; self.stopped=None; self.next_retry_at=None; self.lock=asyncio.Lock()
        self.allowed_origins=allowed_origins or {('https',host,None) for host in ('x.com','www.x.com','api.x.com','twitter.com','api.twitter.com','abs.twimg.com','pbs.twimg.com')}
        state=cooldown_state(self.cooldown_path)
        if state:
            self.stopped=state['reason']; self.next_retry_at=self.to_iso(state['until'])
    @staticmethod
    def to_iso(value): return datetime.fromtimestamp(value,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') if value is not None else None
    def stop(self,reason,until=None,persist=True):
        if self.stopped: raise ReaderStop(self.stopped,self.next_retry_at)
        if persist:
            previous=cooldown_state(self.cooldown_path)
            if previous:
                if previous['until'] is None: reason=previous['reason']; until=None
                elif until is not None: until=max(until,previous['until'])
            try:
                self.cooldown_path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                temporary=self.cooldown_path.with_suffix(self.cooldown_path.suffix+'.tmp')
                temporary.write_text(json.dumps({'reason':reason,'until':until}),encoding='utf-8'); temporary.chmod(0o600); os.replace(temporary,self.cooldown_path)
            except OSError: reason='cooldown_write_failed'; until=None
        self.stopped=reason; self.next_retry_at=self.to_iso(until); raise ReaderStop(reason,self.next_retry_at)
    def check(self):
        if self.stopped: raise ReaderStop(self.stopped,self.next_retry_at)
        if self.count>=self.max_requests: self.stop('request_budget_reached',time.time()+60,persist=False)
        if time.monotonic()>=self.deadline: self.stop('cycle_deadline_reached',time.time()+60,persist=False)
    async def request(self,send,method,url,**kwargs):
        async with self.lock:
            for _ in range(5):
                self.check(); address=urlparse(str(url)); origin=(address.scheme,address.hostname,address.port)
                if origin not in self.allowed_origins or address.username or address.password: self.stop('unexpected_request_destination',time.time()+300)
                if address.path.lower().startswith(('/i/flow/','/account/access','/i/jf/onboarding','/login')): self.stop('login_or_access_challenge')
                delay=0 if self.last is None else self.min_interval-(time.monotonic()-self.last)
                if delay>0:
                    if time.monotonic()+delay>=self.deadline: self.stop('cycle_deadline_reached',time.time()+60,persist=False)
                    await asyncio.sleep(delay)
                self.check(); self.count+=1; self.last=time.monotonic(); kwargs['follow_redirects']=False
                kwargs['timeout']=min(float(kwargs.get('timeout') or 30),max(0.001,self.deadline-time.monotonic()))
                try: response=await send(method,url,**kwargs)
                except asyncio.CancelledError: raise
                except Exception: self.stop('network_error_paused',time.time()+300)
                status=response.status_code
                if status in (401,403): self.stop('login_or_access_challenge')
                reset=response.headers.get('x-rate-limit-reset','0'); reset=int(reset) if str(reset).isdigit() else 0
                retry_after=response.headers.get('retry-after')
                if retry_after is not None:
                    try:
                        retry_time=time.time()+float(retry_after)
                        if not math.isfinite(retry_time): raise ValueError('invalid_retry_after')
                    except (TypeError,ValueError):
                        try: retry_time=email.utils.parsedate_to_datetime(retry_after).timestamp()
                        except (TypeError,ValueError,OverflowError): retry_time=0
                    reset=max(reset,retry_time)
                if status==429 or str(response.headers.get('x-rate-limit-remaining'))=='0': self.stop('rate_limited',max(reset,time.time()+60))
                if status in (301,302,303,307,308):
                    location=response.headers.get('location')
                    if not location: self.stop('unexpected_redirect',time.time()+300)
                    target_url=urljoin(str(url),location); target=urlparse(target_url)
                    if (target.scheme,target.hostname,target.port)!=origin: self.stop('unexpected_cross_origin_redirect',time.time()+300)
                    if target.path.lower().startswith(('/i/flow/','/account/access','/i/jf/onboarding','/login')): self.stop('login_or_access_challenge')
                    url=target_url; kwargs={key:value for key,value in kwargs.items() if key not in {'params','data','json','content','headers','cookies'}}
                    if status in (301,302,303): method='GET'
                    continue
                if status!=200: self.stop('unexpected_api_response',time.time()+300)
                if '/graphql/' in address.path:
                    try: body=response.json()
                    except Exception: self.stop('unexpected_api_response',time.time()+300)
                    if not isinstance(body,dict): self.stop('unexpected_api_response',time.time()+300)
                    errors=body.get('errors',[])
                    if not isinstance(errors,list) or any(not isinstance(error,dict) or type(error.get('code')) is not int for error in errors): self.stop('unexpected_api_response',time.time()+300)
                    codes=[error['code'] for error in errors]
                    if 88 in codes: self.stop('rate_limited',max(reset,time.time()+60))
                    if any(code in (32,326) for code in codes): self.stop('login_or_access_challenge')
                    if codes or not isinstance(body.get('data'),dict): self.stop('unexpected_api_response',time.time()+300)
                return response
            self.stop('redirect_limit_reached',time.time()+300)
