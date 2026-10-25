/* UI-only translations. Project names, signal names, point identifiers and exports
   remain business data; switching language never writes to the database. */
(() => {
  'use strict';
  const messages = {
    '现场设备点位表':['Field I/O Manager','إدارة نقاط الموقع'],
    '信号线编号自动生成':['Automatic signal numbering','ترقيم الإشارات تلقائيًا'],
    '项目总览':['Projects','نظرة عامة على المشاريع'], '项目结构':['Project structure','هيكل المشروع'],
    '页面导航':['Navigation','التنقل'], '主导航':['Main navigation','القائمة الرئيسية'],
    '基础配置':['Settings','الإعدادات الأساسية'], '信号类型配置':['Signal types','إعداد أنواع الإشارات'],
    '用户与权限':['Users & permissions','المستخدمون والصلاحيات'], '登录基础配置':['Sign in to settings','تسجيل الدخول للإعدادات'],
    '基础配置需要管理员账号，其他页面可直接使用':['An administrator account is required for settings. Other pages are available without signing in.','الإعدادات تحتاج حساب مسؤول. باقي الصفحات متاحة بدون تسجيل دخول.'],
    '用户名':['Username','اسم المستخدم'], '密码':['Password','كلمة المرور'], '确认密码':['Confirm password','تأكيد كلمة المرور'],
    '请输入用户名':['Enter username','اكتب اسم المستخدم'], '请输入密码':['Enter password','اكتب كلمة المرور'],
    '登 录':['Sign in','تسجيل الدخول'], '取消，继续使用':['Cancel and continue','إلغاء والمتابعة'],
    '注册新账号':['Create account','إنشاء حساب'], '注册':['Register','إنشاء حساب'],
    '再次输入密码':['Re-enter password','اكتب كلمة المرور مرة ثانية'], '至少 6 位':['At least 6 characters','٦ أحرف على الأقل'],
    '3–32 位字母、数字、_ . -':['3–32 letters, digits, _ . -','من ٣ إلى ٣٢ حرفًا أو رقمًا أو _ . -'],
    '退出登录':['Sign out','تسجيل الخروج'], '修改密码':['Change password','تغيير كلمة المرور'],
    '访客':['Guest','زائر'], '访':['G','ز'], '管理员':['Administrator','مسؤول'], '普通用户':['User','مستخدم'],
    '免登录使用':['No sign-in required','متاح بدون تسجيل دخول'], '安装到手机':['Install app','تثبيت التطبيق'],
    '新增模块':['Add module','إضافة وحدة'], '删除模块':['Delete module','حذف الوحدة'], '编辑模块':['Edit module','تعديل الوحدة'],
    '模块':['Module','وحدة'], '控制柜':['Cabinet','لوحة تحكم'], '模块号':['Module no.','رقم الوحدة'],
    '模块类型':['Module type','نوع الوحدة'], '模块型号':['Module model','موديل الوحدة'],
    '项目名称':['Project name','اسم المشروع'], '柜子号':['Cabinet no.','رقم اللوحة'],
    '设备部位':['Equipment location','موقع المعدة'], '设备点位':['Equipment point','نقطة المعدة'],
    '信号类型':['Signal type','نوع الإشارة'], '传感器类型':['Sensor type','نوع الحساس'],
    '程序名称':['Program name','اسم البرنامج'], '所属设备部位':['Equipment location','موقع المعدة'],
    '信号类型名称':['Signal type name','اسم نوع الإشارة'], '编号简写':['Code abbreviation','اختصار الكود'],
    '简写':['Abbreviation','الاختصار'], '编号':['Code','الكود'], 'PLC点位表达式':['PLC expression','تعبير نقطة PLC'],
    '通道':['Channel','القناة'], '序号':['No.','الرقم'], '排序':['Order','الترتيب'], '操作':['Actions','الإجراءات'],
    '保存':['Save','حفظ'], '正在保存…':['Saving…','جارٍ الحفظ…'], '有未保存修改':['Unsaved changes','تعديلات غير محفوظة'],
    '返回总览':['Back to overview','الرجوع للنظرة العامة'], '返回项目总览':['Back to project','الرجوع للمشروع'],
    '返回项目列表':['Back to projects','الرجوع للمشاريع'], '导出 CSV':['Export CSV','تصدير CSV'],
    '导出 Excel':['Export Excel','تصدير Excel'], '全部通道信息':['All channels','كل القنوات'],
    '控制柜全部通道信息':['All cabinet channels','كل قنوات اللوحة'],
    '选择模块，编辑通道点位表':['Select a module to edit its channels','اختار وحدة لتعديل نقاط القنوات'],
    '选择控制柜，查看柜内模块总览':['Select a cabinet to view its modules','اختار لوحة لعرض وحداتها'],
    '选择项目，查看项目中的控制柜总览':['Select a project to view its cabinets','اختار مشروع لعرض لوحات التحكم'],
    '填写设备点位与信号类型，系统自动生成编号与传感器类型':['Enter equipment points and signal types to generate codes and sensor types automatically','اكتب نقاط المعدات وأنواع الإشارات لإنشاء الأكواد وأنواع الحساسات تلقائيًا'],
    '批量设置部位':['Set location in bulk','تحديد الموقع للكل'], '应用':['Apply','تطبيق'], '搜索':['Search','بحث'],
    '搜索项目 / 柜子 / 模块':['Search project / cabinet / module','ابحث عن مشروع / لوحة / وحدة'],
    '点位 / 编号 / PLC点位表达式':['Point / code / PLC expression','النقطة / الكود / تعبير PLC'],
    '左右滑动表格查看全部列，每行对应一个 PLC 通道。':['Scroll horizontally to view all columns. Each row is one PLC channel.','اسحب الجدول أفقيًا لعرض كل الأعمدة. كل صف يمثل قناة PLC واحدة.'],
    '模块通道点位表，可横向滚动查看全部列':['Module channels; scroll horizontally for all columns','نقاط قنوات الوحدة؛ اسحب أفقيًا لعرض كل الأعمدة'],
    '可编辑':['Editable','قابل للتعديل'], '自动生成':['Automatic','تلقائي'], '备注':['Notes','ملاحظات'], '选填':['Optional','اختياري'],
    '取消':['Cancel','إلغاء'], '确定':['Confirm','تأكيد'], '完成':['Done','تم'], '关闭':['Close','إغلاق'],
    '编辑':['Edit','تعديل'], '删除':['Delete','حذف'], '新增':['Add','إضافة'], '+ 新增':['+ Add','+ إضافة'],
    '查看明细':['View details','عرض التفاصيل'], '查看模块':['View modules','عرض الوحدات'], '查看控制柜':['View cabinets','عرض اللوحات'],
    '模块总数':['Total modules','إجمالي الوحدات'], '点位总数':['Total points','إجمالي النقاط'], '点位':['Points','النقاط'],
    '已配置':['Configured','تم الإعداد'], '待配置':['Unconfigured','غير معدّة'], '待填写或无传感器':['Incomplete or no sensor','غير مكتملة أو بدون حساس'],
    'DI模块 / DO模块':['DI / DO modules','وحدات DI / DO'], '点位已使用 DI/DO':['Used points DI/DO','النقاط المستخدمة DI/DO'],
    '点位空余 DI/DO':['Spare points DI/DO','النقاط الاحتياطية DI/DO'], '已用 / 备用':['Used / spare','مستخدم / احتياطي'],
    '使用率':['Utilization','نسبة الاستخدام'], '正在加载通道信息…':['Loading channels…','جارٍ تحميل القنوات…'],
    '该控制柜暂无通道信息':['No channels in this cabinet','لا توجد قنوات في اللوحة دي'],
    '该柜子下还没有模块':['No modules in this cabinet','لا توجد وحدات في اللوحة دي'],
    '该项目下还没有模块':['No modules in this project','لا توجد وحدات في المشروع ده'],
    '该模块下暂无点位数据':['No points in this module','لا توجد نقاط في الوحدة دي'],
    '该项目下还没有柜子，可通过新增模块添加':['No cabinets yet. Add a module to create one.','لا توجد لوحات بعد. أضف وحدة لإنشاء لوحة.'],
    '暂无项目，请在基础配置中添加项目':['No projects. Add a project in settings.','لا توجد مشاريع. أضف مشروع من الإعدادات.'],
    '暂无项目':['No projects','لا توجد مشاريع'], '请联系管理员在「基础配置」中新增':['Ask an administrator to add one in Settings','اطلب من المسؤول إضافة مشروع في الإعدادات'],
    '— 未选择 —':['— Select —','— اختار —'], '— 请选择 —':['— Select —','— اختار —'], '— 请先选择设备部位 —':['— Select location first —','— اختار موقع المعدة الأول —'],
    '— 暂无匹配部位和模块的信号类型 —':['— No matching signal types —','— لا توجد أنواع إشارات مطابقة —'],
    '请选择设备部位':['Select equipment location','اختار موقع المعدة'], '如 E13':['e.g. E13','مثال E13'],
    '如 光幕':['e.g. light curtain','مثال: ستارة ضوئية'], '如 M':['e.g. M','مثال M'],
    '请输入程序名称':['Enter program name','اكتب اسم البرنامج'], '自动生成的PLC点位表达式':['Generated PLC expression','تعبير PLC المُنشأ تلقائيًا'],
    '上移':['Move up','تحريك لأعلى'], '下移':['Move down','تحريك لأسفل'], '删除该行':['Delete row','حذف الصف'],
    '按住行拖动调整顺序':['Hold and drag a row to reorder','اضغط مطوّلًا واسحب الصف لتغيير الترتيب'],
    '按住拖动排序':['Hold and drag to reorder','اضغط مطوّلًا واسحب لتغيير الترتيب'],
    '按住拖动调整顺序，也可使用上下方向键':['Hold and drag or use the up/down arrow keys','اضغط مطوّلًا واسحب أو استخدم سهم أعلى/أسفل'],
    '按住拖动排序，也可使用上下方向键':['Hold and drag or use the up/down arrow keys','اضغط مطوّلًا واسحب أو استخدم سهم أعلى/أسفل'],
    '维护信号类型、编号简写与传感器类型；按住表格行可上下拖动调整顺序，松开后自动保存':['Manage signal types, abbreviations and sensor types. Hold and drag rows to reorder; release to save.','إدارة أنواع الإشارات والاختصارات والحساسات. اضغط مطوّلًا واسحب الصفوف للترتيب؛ الحفظ تلقائي عند الإفلات.'],
    '新增信号类型':['Add signal type','إضافة نوع إشارة'], '编号生成规则':['Code rules','قواعد إنشاء الأكواد'],
    '「新增模块」弹窗中各下拉框的可选项均在此维护':['Manage the dropdown choices used when adding modules','إدارة اختيارات القوائم المستخدمة عند إضافة وحدات'],
    '按住项目条目拖动排序，松开后自动保存。':['Hold and drag projects to reorder; release to save.','اضغط مطوّلًا واسحب المشاريع للترتيب؛ الحفظ تلقائي عند الإفلات.'],
    '部位以「名称 → 参数」对照，编号中取参数值。默认：现场→B、电机→M':['Location maps a name to a code parameter. Defaults: field → B, motor → M.','الموقع يربط الاسم بمعامل الكود. الافتراضي: الموقع → B، الموتور → M.'],
    'PLC 前缀：DI→I，DO→Q，AI→IW，AO→QW，用于自动生成 PLC 点位':['PLC prefixes: DI→I, DO→Q, AI→IW, AO→QW, for generating PLC addresses','بادئات PLC: DI→I، DO→Q، AI→IW، AO→QW لإنشاء عناوين PLC'],
    '「总通道数」决定新增模块时自动生成的点位行数与 PLC 点位数量':['Channel count determines the rows and PLC addresses created for new modules','عدد القنوات يحدد صفوف النقاط وعناوين PLC المُنشأة للوحدات الجديدة'],
    '总通道数':['Channel count','عدد القنوات'], 'PLC 前缀':['PLC prefix','بادئة PLC'], '编号参数':['Code parameter','معامل الكود'],
    '如 I / Q / IW / QW':['e.g. I / Q / IW / QW','مثال I / Q / IW / QW'], '如 B':['e.g. B','مثال B'], '如 8':['e.g. 8','مثال 8'],
    '暂无选项，点击右上角新增':['No options. Use Add above.','لا توجد اختيارات. اضغط إضافة بالأعلى.'], '暂无模块型号':['No module models','لا توجد موديلات وحدات'],
    '生成预览':['Preview','معاينة'], '请选择模块型号以预览 PLC 点位':['Select a module model to preview PLC addresses','اختار موديل الوحدة لمعاينة عناوين PLC'],
    '完成后将写入数据库并生成对应点位行':['Creates the module and its channel rows','يتم حفظ الوحدة وإنشاء صفوف القنوات الخاصة بها'],
    '新增用户':['Add user','إضافة مستخدم'], '角色':['Role','الصلاحية'], '状态':['Status','الحالة'], '创建时间':['Created at','تاريخ الإنشاء'],
    '设备点位键盘':['Equipment point keyboard','لوحة مفاتيح نقاط المعدات'], '退格':['⌫','⌫'], '清空':['Clear','مسح'],
    '下一行':['Next row','الصف التالي'], '收起':['Close','إغلاق'], '字母、数字同屏输入':['Letters and numbers','حروف وأرقام معًا'],
    '立即同步':['Sync now','مزامنة الآن'], '立即同步（长按设置）':['Sync now (hold for settings)','مزامنة الآن (اضغط مطوّلًا للإعدادات)'],
    '本机模式 · 点击保存后同步':['Local mode · sync on Save','وضع محلي · المزامنة بعد الحفظ'],
    '正在同步，请稍候…':['Syncing, please wait…','جارٍ المزامنة، انتظر…'],
    '已保存到本机 · 点击保存或立即同步后上传':['Saved locally · upload on Save or Sync now','تم الحفظ محليًا · الرفع عند الحفظ أو المزامنة الآن'],
    '同步超时，离线数据已保留':['Sync timed out; offline data is retained','انتهت مهلة المزامنة؛ البيانات المحلية محفوظة'],
    '当前模块有未保存的修改，确定放弃并离开吗？':['Discard unsaved changes and leave this module?','تجاهل التعديلات غير المحفوظة ومغادرة الوحدة؟'],
    '确定删除该点位行？':['Delete this point row?','حذف صف النقطة دي؟'], '确定删除该信号类型？':['Delete this signal type?','حذف نوع الإشارة ده؟'],
    '已新增':['Added','تمت الإضافة'], '已保存':['Saved','تم الحفظ'], '已删除':['Deleted','تم الحذف'], '点位已删除':['Point deleted','تم حذف النقطة'],
    '首次下载 / 同步设置':['Initial download / sync settings','التحميل الأول / إعدادات المزامنة'],
    'VPS HTTPS 地址':['VPS HTTPS address','عنوان HTTPS للخادم'], '移动端同步密钥':['Mobile sync key','مفتاح مزامنة التطبيق'],
    '保存并同步':['Save & sync','حفظ ومزامنة'],
    '数据库保存在手机。首次下载需联网，之后可离线使用。基础配置使用服务器管理员账号，联网登录成功后可离线登录。':['The database is stored on this device. Connect for the first download, then work offline. Sign in to settings with a server administrator account; after an online sign-in you can sign in offline.','قاعدة البيانات محفوظة على الجهاز. التحميل الأول يحتاج إنترنت، وبعده تقدر تشتغل بدون اتصال. ادخل للإعدادات بحساب مسؤول الخادم؛ بعد أول دخول أونلاين تقدر تدخل بدون اتصال.'],
    '请填写有效 HTTPS 地址和至少32位同步密钥':['Enter a valid HTTPS address and a sync key of at least 32 characters','اكتب عنوان HTTPS صحيح ومفتاح مزامنة ٣٢ حرفًا على الأقل'],
    '导出完成':['Export complete','تم التصدير'], '导出失败':['Export failed','فشل التصدير'],
    '编号规则：':['Code rule:','قاعدة الكود:'], '，未填写或无传感器时显示':['; incomplete or no sensor:','؛ لو البيانات ناقصة أو بدون حساس يظهر'],
    '+ 设备部位 +':['+ location +','+ الموقع +'], '+ 设备点位 +':['+ equipment point +','+ نقطة المعدة +'],
    '+ 简写　　传感器类型 = 查表结果':['+ abbreviation; sensor type = lookup result','+ الاختصار؛ نوع الحساس = نتيجة البحث'],
    '未填写设备部位、设备点位或信号类型时，编号显示为':['When location, equipment point or signal type is missing, the code is','لو موقع المعدة أو النقطة أو نوع الإشارة ناقص، الكود يظهر'],
    '普通权限仅可使用「现场设备点位表」；管理员可配置信号类型与基础数据':['Users can edit field points; administrators can also manage signal types and settings','المستخدم يقدر يعدّل نقاط الموقع؛ المسؤول يقدر كمان يدير أنواع الإشارات والإعدادات'],
    '注册后为':['New accounts have','الحساب الجديد بصلاحية'],
    '权限，可使用「现场设备点位表」。首次登录请修改密码。':['permissions for field point editing. Change the password on first sign-in.','لتعديل نقاط الموقع. غيّر كلمة المرور عند أول دخول.'],
    '基础配置需要管理员权限，请使用管理员账号':['Sign in with an administrator account for settings','ادخل بحساب مسؤول لاستخدام الإعدادات'],
    '注册成功，请登录':['Account created. Please sign in.','تم إنشاء الحساب. سجّل الدخول.'],
    '需要管理员权限，请先通过基础配置登录':['Administrator access required. Sign in through Settings.','تحتاج صلاحية مسؤول. سجّل الدخول من الإعدادات.'],
    '请先从左侧项目结构中选择模块':['Select a module in the project tree first','اختار وحدة من هيكل المشروع الأول'],
    '管理员 · 可配置信号类型':['Administrator · signal configuration enabled','مسؤول · يمكن إعداد أنواع الإشارات'],
    '首次登录请先修改密码':['Change your password on first sign-in','غيّر كلمة المرور عند أول دخول'],
    '原密码':['Current password','كلمة المرور الحالية'], '新密码（至少 6 位）':['New password (at least 6 characters)','كلمة مرور جديدة (٦ أحرف على الأقل)'],
    '密码已更新':['Password updated','تم تحديث كلمة المرور'], '折叠':['Collapse','طيّ'], '展开':['Expand','توسيع'],
    '柜子顺序已保存':['Cabinet order saved','تم حفظ ترتيب اللوحات'], '已刷新':['Refreshed','تم التحديث'],
    '导出本控制柜全部模块的 DI/DO 工作表':['Export all cabinet modules in DI/DO sheets','تصدير كل وحدات اللوحة في ورقتي DI/DO'],
    '导出本项目全部控制柜模块的 DI/DO 工作表':['Export all project cabinets and modules in DI/DO sheets','تصدير كل لوحات ووحدات المشروع في ورقتي DI/DO'],
    '该模块':['this module','الوحدة دي'], '编辑模块号':['Edit module number','تعديل رقم الوحدة'],
    '模块号不能为空':['Module number is required','رقم الوحدة مطلوب'], '模块号已更新':['Module number updated','تم تحديث رقم الوحدة'],
    '删除我创建的模块':['Delete my module','حذف الوحدة اللي أنشأتها'], '删除该模块':['Delete this module','حذف الوحدة دي'],
    '— 原信号不匹配部位或模块，请重新选择 —':['— Signal no longer matches; select again —','— الإشارة غير مطابقة؛ اختار مرة ثانية —'],
    '先选部位':['Select location first','اختار الموقع الأول'], '请选择':['Select','اختار'], '暂无信号':['No signals','لا توجد إشارات'],
    '模块点位已保存':['Module points saved','تم حفظ نقاط الوحدة'], '请先从左侧选择模块':['Select a module first','اختار وحدة الأول'],
    '已应用到当前草稿，点击保存后写入数据库':['Applied to draft. Click Save to store changes.','تم التطبيق على المسودة. اضغط حفظ لتخزين التعديلات.'],
    '请先由管理员在「基础配置」中维护各项下拉选项':['Ask an administrator to configure the dropdown options in Settings first','اطلب من المسؤول إعداد اختيارات القوائم في الإعدادات الأول'],
    '请先完成上面 5 项必选配置':['Complete the five required fields above','كمّل الخمس خانات المطلوبة بالأعلى'],
    '柜号':['Cabinet','اللوحة'], '请先保存或放弃未保存修改，再导出模块数据':['Save or discard changes before exporting','احفظ أو تجاهل التعديلات قبل التصدير'],
    '请先选择项目或控制柜':['Select a project or cabinet first','اختار مشروع أو لوحة الأول'],
    '信号类型顺序已保存':['Signal type order saved','تم حفظ ترتيب أنواع الإشارات'], '项目排序已保存':['Project order saved','تم حفظ ترتيب المشاريع'],
    '确定删除该选项？':['Delete this option?','حذف الاختيار ده؟'], '名称':['Name','الاسم'], '编辑用户':['Edit user','تعديل المستخدم'],
    '普通用户（仅现场设备点位表）':['User (field point editing)','مستخدم (تعديل نقاط الموقع)'],
    '管理员（可配置信号类型）':['Administrator (signal configuration)','مسؤول (إعداد أنواع الإشارات)'],
    '停用该账号':['Disable account','تعطيل الحساب'], '重置密码（留空则不修改）':['Reset password (leave blank to keep)','إعادة تعيين كلمة المرور (اتركها فاضية للإبقاء عليها)'],
    '3–32 位字母数字':['3–32 letters or digits','من ٣ إلى ٣٢ حرفًا أو رقمًا'], '初始密码':['Initial password','كلمة المرور الأولية'],
    '请用浏览器菜单中的「添加到主屏幕」安装':['Use Add to Home Screen in the browser menu','استخدم إضافة للشاشة الرئيسية من قائمة المتصفح'],
    '已安装到桌面':['Installed on home screen','تم التثبيت على الشاشة الرئيسية'],
    '基础配置需要管理员账号':['Settings require an administrator account','الإعدادات تحتاج حساب مسؤول'],
    '请先设置同步密钥并联网完成首次下载':['Set the sync key and connect for the initial download','حدد مفتاح المزامنة واتصل بالإنترنت للتحميل الأول'],
    '已编号':['Coded','تم الترقيم'], '传感器种类':['Sensor types','أنواع الحساسات'], '创建者：':['Created by:','أنشأها:'],
    '我创建的':['Created by me','أنشأتها أنا'], '我':['Me','أنا'],
    '此模块由其他账号创建，无删除权限；点位字段可编辑':['Created by another account; points are editable but deletion is restricted','أنشأها حساب آخر؛ تقدر تعدّل النقاط لكن الحذف غير مسموح'],
    '该类型下暂无模块型号':['No models for this type','لا توجد موديلات للنوع ده'], '将生成':['Creates','سيتم إنشاء'],
    '服务器尚未支持移动端同步':['Server does not support mobile sync yet','الخادم لا يدعم مزامنة التطبيق حاليًا'],
    '同步协议不匹配':['Sync protocol mismatch','بروتوكول المزامنة غير متطابق'],
    '请使用服务器账号联网登录后修改密码':['Sign in online with a server account before changing your password','ادخل أونلاين بحساب الخادم قبل تغيير كلمة المرور'],
    '账号请在 VPS 网站维护，手机不保存服务器账号和密码哈希':['Manage accounts on the VPS website; server accounts are not stored on this device','إدارة الحسابات من موقع الخادم؛ حسابات الخادم غير محفوظة على الجهاز'],
    '用户名或密码错误':['Incorrect username or password','اسم المستخدم أو كلمة المرور غير صحيحة'],
    '请输入用户名和密码':['Enter username and password','اكتب اسم المستخدم وكلمة المرور'],
    '尝试次数过多，请 5 分钟后再试':['Too many attempts. Try again in 5 minutes.','محاولات كتير. جرّب تاني بعد ٥ دقائق.'],
    '密码至少 6 位':['Password must be at least 6 characters','كلمة المرور لازم تكون ٦ أحرف على الأقل'],
    '新密码至少 6 位':['New password must be at least 6 characters','كلمة المرور الجديدة لازم تكون ٦ أحرف على الأقل'],
    '两次输入的密码不一致':['Passwords do not match','كلمتا المرور غير متطابقتين'], '原密码不正确':['Current password is incorrect','كلمة المرور الحالية غير صحيحة'],
    '该用户名已被注册':['Username is already registered','اسم المستخدم مسجّل قبل كده'],
    '名称不能为空':['Name is required','الاسم مطلوب'], '信号类型名称不能为空':['Signal type name is required','اسم نوع الإشارة مطلوب'],
    '请选择有效的所属设备部位':['Select a valid equipment location','اختار موقع معدة صحيح'],
    '该信号类型已存在':['Signal type already exists','نوع الإشارة موجود بالفعل'], '该信号类型名称已存在':['Signal type name already exists','اسم نوع الإشارة موجود بالفعل'],
    '该选项已存在':['Option already exists','الاختيار موجود بالفعل'], '记录不存在':['Record not found','السجل غير موجود'],
    '需要有效的移动端同步密钥':['A valid mobile sync key is required','مطلوب مفتاح مزامنة صحيح'],
    '请先设置同步地址与密钥':['Set the sync address and key first','حدد عنوان ومفتاح المزامنة الأول'],
    '请检查密钥或数据冲突':['Check the key or data conflicts','راجع المفتاح أو تعارض البيانات'],
    '同步数据过大':['Sync data is too large','بيانات المزامنة كبيرة جدًا'], '同步协议版本不兼容':['Incompatible sync protocol version','إصدار بروتوكول المزامنة غير متوافق'],
    '待改密':['Password change required','مطلوب تغيير كلمة المرور'], '已停用':['Disabled','معطّل'], '正常':['Active','نشط']
  };
  // Anchored UI templates preserve captured names/addresses exactly.
  const patterns = [
    [/^同步接口 HTTP (\d+)：(.+)$/, ['Sync HTTP {1}: {2}','المزامنة HTTP {1}: {2}']],
    [/^同步未提交，请处理数据冲突后重试：(.+)$/, ['Sync not saved; resolve data conflicts and retry: {1}','لم يتم حفظ المزامنة؛ حل تعارض البيانات وحاول تاني: {1}']],
    [/^(.+) · 共 (\d+) 通道$/, ['{1} · {2} channels','{1} · {2} قناة']],
    [/^通道 (\d+)$/, ['Channel {1}','القناة {1}']],
    [/^其余 (\d+) 通道自动顺延$/, ['Remaining {1} channels follow automatically','باقي {1} قناة تُضاف تلقائيًا']],
    [/^行点位（模块型号「(.+)」的总通道数）$/, ['point rows (channel count of model {1})','صف نقطة (عدد قنوات الموديل {1})']],
    [/^(\d+) 通道 · PLC (.+)$/, ['{1} channels · PLC {2}','{1} قناة · PLC {2}']],
    [/^确定删除(.+)吗？([\s\S]*)$/, ['Delete {1}?{2}','حذف {1}؟{2}']],
    [/^其中包含 (\d+) 条点位记录，删除后不可恢复。$/, ['Contains {1} point records. Deletion cannot be undone.','تحتوي على {1} نقطة. الحذف نهائي.']],
    [/^模块 (.+)$/, ['Module {1}','الوحدة {1}']],
    [/^新增(.+)$/, ['Add {1}','إضافة {1}']], [/^编辑(.+)$/, ['Edit {1}','تعديل {1}']],
    [/^无法读取登录状态：(.+)$/, ['Unable to read sign-in status: {1}','تعذر قراءة حالة الدخول: {1}']],
    [/^加载项目失败：(.+)$/, ['Project loading failed: {1}','فشل تحميل المشروع: {1}']],
    [/^共 (\d+) 个控制柜$/, ['{1} cabinets','{1} لوحة تحكم']],
    [/^总通道 (\d+)$/, ['Total channels {1}','إجمالي القنوات {1}']],
    [/^完成率 (\d+)%$/, ['Completion {1}%','نسبة الإكمال {1}%']],
    [/^(\d+)% 已配置$/, ['{1}% configured','{1}% تم الإعداد']],
    [/^(\d+) 个$/, ['{1}','{1}']], [/^(\d+) 条$/, ['{1}','{1}']],
    [/^(\d+) 个 \/ (\d+) 个$/, ['{1} / {2}','{1} / {2}']],
    [/^(\d+) \/ (\d+) 条$/, ['{1} / {2}','{1} / {2}']],
    [/^共 (\d+) 个模块，(\d+) 条通道 · 已用 (\d+) \/ 备用 (\d+)$/, ['{1} modules, {2} channels · used {3} / spare {4}','{1} وحدة، {2} قناة · مستخدم {3} / احتياطي {4}']],
    [/^已同步 (.+) · 数据已保存在本机$/, ['Synced {1} · stored on this device','تمت المزامنة {1} · البيانات محفوظة على الجهاز']],
    [/^离线可用 \/ 同步未完成：(.+)$/, ['Offline available / sync incomplete: {1}','متاح بدون اتصال / المزامنة غير مكتملة: {1}']],
    [/^首次运行需联网下载：(.+)$/, ['First download requires a connection: {1}','التحميل الأول يحتاج إنترنت: {1}']],
    [/^控制柜 (.+)$/, ['Cabinet {1}','لوحة {1}']],
    [/^(.+) \/ 模块 (.+)$/, ['{1} / Module {2}','{1} / الوحدة {2}']],
    [/^通道信息加载失败，请刷新重试：(.+)$/, ['Channel loading failed; refresh to retry: {1}','فشل تحميل القنوات؛ حدّث الصفحة للمحاولة: {1}']]
  ];
  let language='zh-CN';
  try { const saved=localStorage.getItem('spt.language');if(['zh-CN','en','ar-EG'].includes(saved))language=saved; } catch {}
  function t(text) {
    if(typeof text!=='string'||language==='zh-CN')return text;
    const key=text.trim(),index=language==='en'?0:1;
    let translated=messages[key]?.[index];
    if(!translated)for(const [pattern,values] of patterns){const match=key.match(pattern);if(match){translated=values[index].replace(/\{(\d+)\}/g,(_,n)=>/\^新增|\^编辑|\^确定删除|\^离线可用|\^首次运行|\^同步接口/.test(pattern.source)?t(match[Number(n)]):match[Number(n)]);break;}}
    return translated?text.replace(key,translated):text;
  }
  const originals=new WeakMap(),attributes=new WeakMap();
  const protectedSelector='[translate="no"],script,style,code,textarea,.t-label,.opt-name,.opt-row .opt-tag,.cell-auto,#usersBody td strong,#moduleOwner b,#userName:not([data-guest]),#userAvatar:not([data-guest]),#overviewTitle[data-business-title],.module-list-row td:not(.module-list-actions),#cabinetChannelsBody td,#signalsBody td:not(:first-child):not(:last-child)';
  function translateNode(node){
    const parent=node.parentElement;if(!parent||parent.closest(protectedSelector))return;
    if(parent.tagName==='OPTION'&&parent.value!==''&&!parent.hasAttribute('data-ui-label'))return;
    const saved=originals.get(node),source=saved&&node.data===saved.output?saved.source:node.data,output=t(source);
    originals.set(node,{source,output});if(node.data!==output)node.data=output;
  }
  function translateElement(el){
    if(!el.closest('[translate="no"],script,style'))for(const name of ['placeholder','title','aria-label','data-label']){
      if(name==='title'&&el.matches('select[data-k="signal_type_id"]')&&el.value!=='')continue;
      if(!el.hasAttribute(name)||el.matches('.t-label,.cell-plc-expression'))continue;
      // Keep structural keys stable: existing editing and print CSS use data-label.
      if(name==='data-label'){el.setAttribute('data-localized-label',t(el.getAttribute(name)));continue;}
      const value=el.getAttribute(name),records=attributes.get(el)||{},old=records[name],source=old&&old.output===value?old.source:value,output=t(source);
      records[name]={source,output};attributes.set(el,records);if(value!==output)el.setAttribute(name,output);
    }
  }
  function apply(root=document.body){
    if(!root)return;
    if(root.nodeType===3){translateNode(root);return;}
    if(root.nodeType!==1)return;
    translateElement(root);const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){if(node.nodeType===3)translateNode(node);else translateElement(node);}
  }
  function setLanguage(next){
    if(!['zh-CN','en','ar-EG'].includes(next))return;
    language=next;try{localStorage.setItem('spt.language',next);}catch{}
    document.documentElement.lang=next;document.documentElement.dir=next==='ar-EG'?'rtl':'ltr';
    document.title=t('现场设备点位表');apply();
    document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===next)));
    window.NativeStore?.setLanguage?.(next);
    document.dispatchEvent(new CustomEvent('languagechange',{detail:next}));
  }
  window.I18n={t,setLanguage,get language(){return language;}};
  const confirmOriginal=window.confirm.bind(window);window.confirm=text=>confirmOriginal(t(text));
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));
    setLanguage(language);
    new MutationObserver(records=>{for(const record of records){if(record.type==='childList')record.addedNodes.forEach(apply);else if(record.type==='characterData')apply(record.target);else translateElement(record.target);}}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label','data-label']});
  });
})();
