// 初中英语（人教版 2024）。key 为 "je章.节"。
import type { SubjectPack } from './pack';

// 题眼匹配前会去掉所有空白，英文短语要按连写形式匹配（如 havebeento），并且不能依赖 \b 词边界
export const jEnglish: SubjectPack = {
  id: 'j-english', name: '英语', stage: '初中英语', level: 'junior', family: 'english', prefix: 'je', textbook: '人教版 2024',
  textbooks: ['人教版 2024', '外研版', '译林版', '北师大版', '冀教版', '仁爱版', '沪教牛津版'],
  books: ['语音与词汇', '词法', '时态与语态', '句法', '阅读', '完形填空', '写作', '听说'],
  chapters: [
    { book: '语音与词汇', ch: '语音', sec: ['音标与字母组合发音', '单词重音', '连读与失去爆破', '语调与意群'] },
    { book: '语音与词汇', ch: '构词法', sec: ['合成词', '派生词（前缀与后缀）', '转化词', '词性转换'] },
    { book: '语音与词汇', ch: '词汇与固定搭配', sec: ['核心词汇辨析', '动词短语', '固定搭配', '习惯用语'] },
    { book: '词法', ch: '名词', sec: ['可数名词与不可数名词', '名词复数', '名词所有格', '名词作定语'] },
    { book: '词法', ch: '冠词', sec: ['不定冠词', '定冠词', '零冠词'] },
    { book: '词法', ch: '代词', sec: ['人称代词与物主代词', '反身代词', '指示代词', '不定代词', '疑问代词', 'it 的用法'] },
    { book: '词法', ch: '数词', sec: ['基数词与序数词', '分数、百分数与小数', '时间、日期与年份', '数词作定语'] },
    { book: '词法', ch: '介词', sec: ['时间介词', '地点与方位介词', '方式与工具介词', '常用介词辨析'] },
    { book: '词法', ch: '形容词和副词', sec: ['形容词的用法与位置', '副词的用法', '比较级和最高级的构成', '比较级句型', '最高级句型', '原级比较 as...as'] },
    { book: '词法', ch: '动词', sec: ['实义动词与系动词', '助动词', '情态动词', '动词不定式', '动名词', '感官动词与使役动词'] },
    { book: '时态与语态', ch: '一般现在时与现在进行时', sec: ['一般现在时', '第三人称单数', '现在进行时', '现在分词的构成'] },
    { book: '时态与语态', ch: '过去时', sec: ['一般过去时', '动词过去式', '过去进行时', 'used to'] },
    { book: '时态与语态', ch: '将来时', sec: ['一般将来时', 'be going to', '现在进行时表将来', '过去将来时'] },
    { book: '时态与语态', ch: '现在完成时', sec: ['现在完成时的构成与用法', '过去分词', '时间段与时间点（for/since）', '延续性与非延续性动词', '去过与去了（been/gone to）', '现在完成时与一般过去时辨析'] },
    { book: '时态与语态', ch: '过去完成时与时态综合', sec: ['过去完成时', '时态辨析与时间状语', '语篇中的时态一致'] },
    { book: '时态与语态', ch: '被动语态', sec: ['被动语态的构成', '一般现在时和一般过去时的被动语态', '含情态动词的被动语态', '将来时和完成时的被动语态', '主动形式表被动'] },
    { book: '句法', ch: '简单句与并列句', sec: ['句子成分', '五种基本句型', '主谓一致', '并列句与并列连词'] },
    { book: '句法', ch: '句子种类', sec: ['一般疑问句', '特殊疑问句', '选择疑问句', '反意疑问句', '祈使句', '感叹句'] },
    { book: '句法', ch: '宾语从句', sec: ['宾语从句的引导词', '宾语从句的语序', '宾语从句的时态'] },
    { book: '句法', ch: '状语从句', sec: ['时间状语从句', '条件状语从句', '原因状语从句', '让步状语从句', '目的和结果状语从句', '比较状语从句'] },
    { book: '句法', ch: '定语从句', sec: ['关系代词 who/whom/which/that', '关系代词 whose', '关系副词 when/where/why', '只能用that的情况'] },
    { book: '句法', ch: '特殊句式', sec: ['there be 句型', 'it 作形式主语', 'so/neither 倒装', 'too...to 与 so...that', '直接引语和间接引语', '句型转换'] },
    { book: '阅读', ch: '阅读理解', sec: ['细节理解', '主旨大意', '推理判断', '词义猜测', '作者意图与态度', '篇章结构与句子还原'] },
    { book: '阅读', ch: '阅读文体', sec: ['记叙文', '说明文', '应用文（广告、通知、图表）', '议论文', '任务型阅读'] },
    { book: '完形填空', ch: '完形填空', sec: ['上下文语境线索', '词汇复现与同义替换', '逻辑关系（转折、因果、递进）', '词义辨析与固定搭配', '情节与情感线索'] },
    { book: '完形填空', ch: '语篇填空', sec: ['语法填空', '首字母填空', '短文选词填空', '适当形式填空'] },
    { book: '写作', ch: '基础写作', sec: ['连词成句', '句子翻译', '衔接与过渡词', '审题与要点覆盖'] },
    { book: '写作', ch: '书面表达', sec: ['书信与电子邮件', '记叙类写作', '介绍类写作', '观点表达类写作', '看图写作', '高级词汇与句式'] },
    { book: '听说', ch: '听力', sec: ['关键信息提取', '数字、时间与地点听辨', '短对话理解', '长对话与独白理解', '听后记录与转述'] },
    { book: '听说', ch: '口语与情景交际', sec: ['日常交际用语', '补全对话', '朗读短文', '话题简述与问答'] },
  ],
  edges: `
0.1:0.0 0.2:0.0 0.3:0.1
1.1:1.0 1.2:1.0 1.3:1.1,1.2
2.1:2.0 2.2:2.0 2.3:2.2
3.1:3.0 3.2:3.0 3.3:3.0
4.0:3.0 4.1:3.0 4.2:4.0,4.1
5.1:5.0 5.2:5.0 5.3:5.0 5.4:5.0 5.5:5.0
6.1:6.0 6.2:6.0 6.3:6.0
7.1:7.0 7.2:7.0 7.3:7.0,7.1,7.2
8.1:8.0 8.2:8.0,8.1 8.3:8.2 8.4:8.2 8.5:8.0
9.1:9.0 9.2:9.0 9.3:9.0 9.4:9.0 9.5:9.3
10.0:9.0 10.1:10.0,3.1 10.3:9.0 10.2:10.0,9.1,10.3
11.0:9.0 11.1:11.0 11.2:11.0,10.2 11.3:11.0
12.0:9.2,10.0 12.1:12.0 12.2:10.2 12.3:12.0,11.0
13.1:11.1 13.0:13.1,9.1 13.2:13.0 13.3:13.0 13.4:13.0 13.5:13.0,11.0
14.0:13.0,11.0 14.1:13.5,12.0,11.2 14.2:14.1
15.0:13.1 15.1:15.0,10.0,11.0 15.2:15.0,9.2 15.3:15.0,12.0,13.0 15.4:15.0
16.0:9.0 16.1:16.0 16.2:16.0,3.1 16.3:16.1
17.0:9.1 17.1:17.0,5.4 17.2:17.0 17.3:17.0,5.0 17.4:9.0 17.5:8.0
18.0:16.1 18.1:18.0,17.1 18.2:18.0,14.1
19.0:16.3 19.1:19.0 19.2:16.3 19.3:16.3 19.4:16.3 19.5:8.3
20.0:16.1,5.0 20.1:20.0 20.2:20.0 20.3:20.0
21.0:16.1,16.2 21.1:9.3,5.5 21.2:9.1 21.3:9.3,19.4 21.4:18.1,18.2 21.5:21.3
22.1:22.0 22.2:22.0 22.3:1.1,22.0 22.4:22.2 22.5:22.1
23.0:22.0 23.1:22.0 23.2:22.0 23.3:22.1 23.4:22.0
24.0:22.0 24.1:24.0 24.2:24.0,16.3 24.3:2.0,2.2 24.4:24.0
25.0:14.1,9.3,8.2 25.1:2.0,24.0 25.2:1.3 25.3:1.3,10.1,11.1
26.0:16.1 26.1:16.1,2.2 26.2:16.3 26.3:22.1
27.0:26.2,26.3 27.1:27.0,11.0 27.2:27.0,10.0 27.3:27.0,9.2 27.4:26.3 27.5:19.0,20.0,18.0
28.1:6.2 28.2:28.0 28.3:28.2 28.4:28.3
29.1:29.0 29.2:0.3 29.3:29.2
`,
  cues: [
    [/音标|读音|发音|划线部分.{0,4}(相同|不同)|重音|连读|失去爆破|语调|升调|降调|意群/, ['0.0', '0.1', '0.3']],
    [/合成词|派生词|前缀|后缀|构词/, ['1.1', '1.0', '1.2']],
    [/语法填空|填入.{0,4}适当的?词|(所给|括号内|括号中).{0,6}(词|单词).{0,4}(正确|适当)形式|词性转换/, ['25.0', '25.3', '1.3']],
    [/首字母/, ['25.1']], [/选词填空|方框(中|内)|inthebox/i, ['25.2']],
    [/动词短语|短语动词|[A-D][.．](look|give|gave|put|take|took|turn|get|got|set|cut|run|ran|come|came|pick|work|find|found|hand|make|made)(s|ed|ing)?(after|for|up|off|down|out|on|along|over|into)(?=[A-D][.．]|$)/, ['2.1']],
    [/固定搭配|(be|am|is|are|was|were|been)(interested|good|afraid|proud|famous|full|busy|strict|different|tired|worried|ready|similar)(in|at|of|for|with|from|about|to)|insteadof|becauseof/i, ['2.2']],
    [/可数|不可数|[Aa]pieceof|piecesof|[A-D][.．](much|many|alittle|afew|little|few)(?=[A-D][.．]|$)/, ['3.0']],
    [/名词复数|复数|所有格|(Children|Women|Teachers|Mother|Father)['’]?s['’]?Day/, ['3.1', '3.2']],
    [/冠词|\b(?:an?|the|\/)[;；](?:an?|the|\/)(?![a-z])/, ['4.0', '4.1', '4.2']],
    [/人称代词|物主代词|[A-D][.．](me|my|mine|him|his|her|hers|them|their|theirs|us|our|ours|your|yours)(?=[A-D][.．]|$)/, ['5.0']],
    [/反身代词|myself|yourself|himself|herself|itself|ourselves|yourselves|themselves/i, ['5.1']],
    [/不定代词|[A-D][.．](some|any|no|every)(thing|body|one)|[A-D][.．](another|others|theother|none|either|neither|both|all|each)(?=[A-D][.．]|$)/, ['5.3']],
    [/基数词|序数词|(hundreds|thousands|millions)of|year-old|\d+-(year|meter|metre|day|minute|hour)/i, ['6.0', '6.3']],
    [/分数|百分数|percent|%|[a-z]+-thirds|onethird|onequarter/i, ['6.1']],
    [/介词|[A-D][.．](in|on|at|for|with|by|of|from|to|about|during|through|across|over|along|between|among|without|like)[A-D][.．](in|on|at|for|with|by|of|from|to|about|during|through|across|over|along|between|among|without|like)(?=[A-D][.．]|$)/, ['7.3', '7.0', '7.1']],
    [/比较级|than(?!k)|as(…|\.{3})as|原级/i, ['8.3', '8.5', '8.2']], [/最高级|themost|theleast|thebest|theworst|oneofthe/i, ['8.4', '8.2']],
    [/形容词|副词|[A-D][.．]([a-z]+)[A-D][.．]\1ly(?=[A-D][.．]|$)/, ['8.1', '8.0']],
    [/情态动词|mustn['’]t|needn['’]t|[A-D][.．](can|could|may|might|must|should|need|haveto|hasto)(?=[A-D][.．]|$)/, ['9.2']],
    [/不定式|动名词|非谓语|[A-D][.．]to[a-z]+[A-D][.．][a-z]+ing|(enjoy|finish|mind|practi[cs]e|avoid|consider|suggest|keep|feellike|can['’]thelp|lookforwardto|beusedto|want|decide|hope|plan|agree|refuse|wish|expect|learn|forget|remember|stop)(s|ed|ing)?_{2,}/, ['9.3', '9.4']],
    [/感官动词|使役动词|((make|let|have|see|watch|hear|notice|feel)(s|es|ed)?|made|had|saw|heard|felt)(me|him|her|us|them|you|it|sb)_{2,}/, ['9.5']],
    [/一般现在时|第三人称单数|三单|everyday|usually|often|always|onceaweek|twiceaweek/i, ['10.0', '10.1']],
    [/现在进行时|Look!|Listen!|atthemoment|atpresent|rightnow/i, ['10.2']],
    [/一般过去时|yesterday|last(night|week|month|year|Sunday|Monday|weekend|summer|winter|term)|(\d+|a|one|two|three|four|five|ten|many)(days|weeks|months|years)ago|justnow|in(19|20)\d\d/i, ['11.0', '11.1']],
    [/过去进行时|atthistimeyesterday|atthattime|at\d+(:\d+)?(a\.?m\.?|p\.?m\.?|o['’]clock)?(yesterday|last)|usedto/i, ['11.2', '11.3']],
    [/一般将来时|tomorrow|next(week|month|year|Sunday|Monday|weekend|summer|term)|inthefuture|soon|in\d+(years|days)|(am|is|are)goingto/i, ['12.0', '12.1']],
    [/现在完成时|since|already|sofar|forthepast|inthepast(\d+|few|two|three)|recently|yet[.?]|ever\?|never(been|seen|heard)/i, ['13.0', '13.2']],
    [/ha(ve|s)(been|gone)(to|in)/i, ['13.4']],
    [/延续性|非延续性|[A-D][.．](borrowed|kept|bought|had|joined|beenin|beenaway|died|beendead|left)[A-D][.．](borrowed|kept|bought|had|joined|beenin|beenaway|died|beendead|left)/, ['13.3']],
    [/过去完成时|hadalready|bythetime|bytheendof(last|(19|20)\d\d)|had(done|finished|left|gone|been|seen|eaten|started|arrived|begun)/i, ['14.0']],
    [/被动语态|被动|bemade(of|from|in|into|by)|(is|are|was|were|be|been)(made|built|written|invented|held|spoken|grown|sold|taught|known|planted|called|found|given|taken|told|allowed|cleaned|kept|seen|done|shown|sent)(by|in|of|from|into|at|for|to|as)|[A-D][.．](is|are|was|were|be|been|willbe|hasbeen|havebeen)[a-z]{2,12}(ed|en|wn|lt|ld|ght|de|ne)(?=[A-D][.．]|$)/i, ['15.0', '15.1']],
    [/(can|must|should|may|could|will|need|won['’]t|can['’]t|mustn['’]t|shouldn['’]t)be(made|built|written|done|seen|taken|given|kept|thrown|held|grown|[a-z]{2,10}ed)|(have|has|had)been(made|built|written|done|seen|taken|given|kept|held|grown|[a-z]{2,10}ed)(by|in|for|since)/i, ['15.2', '15.3']],
    [/主谓一致|thenumberof|anumberof|aswellas|alongwith|togetherwith|eachof|并列(句|连词)|both[a-z]{1,20}and|notonly[a-z]{1,30}butalso|either[a-z]{1,20}or|neither[a-z]{1,20}nor/i, ['16.2', '16.3']],
    [/句子成分|主语|谓语|宾语补足语|宾补|表语|基本句型|主系表|主谓宾/, ['16.0', '16.1']],
    [/特殊疑问|对(划|画)线部分提问|[A-D][.．]How(long|soon|often|far|many|much|old)[A-D][.．]/, ['17.1']],
    [/反意疑问|[,，](is|are|was|were|do|does|did|has|have|can|will|should|could|must)(n['’]t)?(it|he|she|they|you|we|I|there)\?|[,，]_{2,}\?/, ['17.3']],
    [/感叹句|[A-D][.．]What(an?)?[A-D][.．]How|What(a|an)[a-z]+!|How[a-z]+!/, ['17.5']],
    [/宾语从句|(Could|Can|Would)you(please)?tellme|Iwonder|Idon['’]tknow|Doyouknow|Iwanttoknow|I(am|['’]m)notsure|Ican['’]tremember|whether/i, ['18.1', '18.0', '18.2']],
    [/时间状语从句|主将从现|notuntil|until|assoonas/i, ['19.0', '19.1']],
    [/条件状语从句|unless|aslongas|(^|[.?!:：])If[^.?!]{1,40}[,，][^.?!]{0,12}(will|won['’]t|['’]ll)/, ['19.1']],
    [/原因状语从句|because(?!of)/i, ['19.2']], [/让步状语从句|although|though|eventhough|evenif/i, ['19.3']],
    [/目的状语从句|结果状语从句|sothat|inorder(that|to)|so(\.{3}|…)that|such(\.{3}|…)that|too(\.{3}|…)to|enoughto/i, ['19.4', '21.3']],
    [/定语从句|关系(代|副)词|[A-D][.．](who|whom|which|whose|that|where|when|what)[A-D][.．](who|whom|which|whose|that|where|when|what)(?=[A-D][.．]|$)/, ['20.0', '20.2', '18.0']],
    [/[Tt]here(is|are|was|were|willbe|isgoingtobe|has|have)/, ['21.0']],
    [/形式主语|It(['’]s|is|was)[a-z]{2,15}(for|of)[a-z]{1,12}to/i, ['21.1']],
    [/倒装|So(do|does|did|am|is|are|was|were|have|has|had|can|could|will|would)(I|he|she|we|they|you|it)|Neither(do|does|did|am|is|are|was|were|have|has|can|will)|Nor(do|does|did|am|is|are|can)/, ['21.2']],
    [/直接引语|间接引语|asked(me|him|her|them|us)(if|whether|what|where|when|how|why)/i, ['21.4', '18.0']],
    [/同义句|句型转换|改为(否定句|一般疑问句|感叹句|被动语态)|保持句意不变/, ['21.5']],
    [/主旨|mainidea|besttitle|mainlyabout|mainlytalksabout|标题/i, ['22.1']],
    [/推断|推理|infer|Wecan(learn|know|conclude)|probably|implies/i, ['22.2', '22.0']],
    [/词义猜测|underlined|(划|画)线(词|单词)|refersto|closestinmeaning/i, ['22.3']],
    [/写作目的|作者.{0,4}(意图|态度|目的)|author|writer['’]?s?(purpose|attitude)|purposeof|attitude/i, ['22.4']],
    [/句子还原|七选五|六选五|选出能填入|Wherecanwe(probably)?(find|read)|Inwhich(part|section)|correctorder/i, ['22.5']],
    [/广告|通知|海报|图表|notice|poster|advertisement|timetable|schedule|ticket|Price[:：]|Tel[:：]|Address[:：]/i, ['23.2']],
    [/任务型阅读|回答问题|Answerthequestions|不超过\d+个?(词|单词)|nomorethan\d+words/i, ['23.4']],
    [/完形填空|掌握其大意/, ['24.0', '24.3']],
    [/连词成句|连词组句|组成句子/, ['26.0']], [/汉译英|英译汉|翻译|根据汉语意思完成句子|根据所给汉语|完成句子/, ['26.1', '2.2']],
    [/书面表达|作文|词数|不少于\d+个?(词|单词)|\d{2,3}个?(词|单词)左右|\d{2,3}words/i, ['26.3', '27.5']],
    [/Dear|Yours|e-?mail|电子邮件|书信|回信|写一封信/i, ['27.0']], [/看图|根据(图片|图示)|图片内容/, ['27.4']],
    [/经历|难忘|experience|unforgettable|Iwillneverforget/i, ['27.1']], [/介绍|introduce|myfavou?rite|hometown/i, ['27.2']],
    [/观点|看法|opinion|advantages|disadvantages|利弊|agreeordisagree/i, ['27.3']],
    [/听力|听对话|听短文|听下面|录音|听句子/, ['28.0', '28.2']], [/听.{0,10}(记录|填写|完成表格|信息记录)|转述/, ['28.4']],
    [/补全对话|对话填空|完成对话|情景交际|交际用语|Itdoesn['’]tmatter|Mypleasure|You['’]rewelcome|Withpleasure|Nevermind|That['’]sallright|Notatall|Haveagoodtime|Congratulations|Goodluck|Soundsgreat|Goodidea/i, ['29.1', '29.0']],
    [/朗读|跟读|话题简述|口语|情景问答/, ['29.2', '29.3']],
  ],
  toolChapters: [],
  qtypes: ['单选', '完形填空', '阅读理解', '任务型阅读', '词汇运用', '语法填空', '书面表达', '听力', '其他'],
  guessType(text) {
    if (/听力|听对话|听短文|听下面|录音|听句子|听材料/.test(text)) return '听力';
    if (/书面表达|作文|词数|不少于\s*\d+\s*个?(词|单词)|\d{2,3}\s*个?(词|单词)左右|\d{2,3}\s*words/i.test(text)) return '书面表达';
    if (/完形填空|掌握其大意/.test(text)) return '完形填空';
    if (/任务型阅读|根据短文内容回答|回答问题|answer the questions|不超过\s*\d+\s*个?(词|单词)|no more than \d+ words/i.test(text)) return '任务型阅读';
    if (/语法填空|在空白处填入|填入.{0,4}适当的?词|括号(内|中).{0,8}(正确|适当)形式/.test(text)) return '语法填空';
    if (/首字母|所给词的(正确|适当)形式|词的适当形式|选词填空|方框|单词拼写|根据(汉语|中文)提示|词汇运用/.test(text)) return '词汇运用';
    if (/阅读理解|阅读下面|阅读短文|passage/i.test(text)) return '阅读理解';
    if (/[A-D][.．、]\s*\S/.test(text) || /下列/.test(text)) return '单选';
    return '其他';
  },
  demos: false,
  prompt: {
    persona: '你是中国初中英语教研老师，熟悉人教版 2024 教材、2022 版义务教育英语课程标准和中考题。不需要公式和 LaTeX，英文部分保持地道、规范。只输出要求的 JSON，不要多余文字。',
    assistant: '你是一位中国初中英语老师的课堂助手，正在一对一网课中帮助老师。讲解用简体中文，英文例句准确地道、难度符合初中（课标三级）要求；语法术语用国内教材的通用说法（如"宾语从句""现在完成时"），必要时给出英文例句和中文翻译。',
    read: '图片是一道初中英语题（可能是课件截图或学生的屏幕）。先把题目完整转写成文字：英文原文逐字照录，保留原有大小写、标点、段落和题号，不要改正拼写或语法（那可能正是考点）；空格统一写成 ____，带题号的空格写成 (1)____；划线词用「」标出；中文提示和题目要求原样保留；有图片、表格或海报时在末尾用一句"图：…"描述关键信息，没有图就不要提。图里有多道题时只转写最完整、最显眼的一道（完形填空、阅读理解等连同短文和全部小题一起转写）。',
    answer: '最终答案（单选、完形、阅读写字母；填空写所填单词或短语的正确形式；任务型阅读写简短答句；书面表达写要点提纲和参考范文；多空或多问用 (1)(2) 分开）',
    draft: '要求：英语地道自然、拼写和语法无误，词汇和句式不超出初中课标（三级）要求，超纲词给中文注释；语篇话题贴近初中生生活、内容积极；单选题语境足以确定答案，干扰项合理且只有一个最佳答案；阅读和完形材料原创或改写，不要照抄常见教辅原题和中考原题；每题只考 1~2 个知识点；不需要公式和 LaTeX。',
    solve: '先检查这道题本身：英语是否地道无误、语境是否足以确定唯一答案、是否有两个选项都对、短文与题目是否一致。按中考英语惯例理解（用法以教材为准），只有会导致无解、答案不唯一或语言错误时才算有问题，措辞不够严谨不算。再独立作答，只给最终答案（选项字母或所填单词；多空或多问用 (1)(2) 分开）。',
    outline: '结构：学习目标 → 情境或语篇导入（对话、短文）→ 词汇与语法要点（每页 3~5 条，配英文例句和中文翻译）→ 例题与练习（含答案）→ 易错辨析 → 小结。',
    explain: '讲题时先找语境线索（时间状语、上下文、固定搭配、逻辑关系），再讲语法规则；英文例句标出考点，必要时给中文翻译；不需要公式。',
    draw: '把截图里的题目画成清楚的语法结构图（如句子成分划分、从句结构、时态时间轴）或语篇结构图，用英文例句加中文标注说明',
  },
};
